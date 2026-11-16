"""FastAPI microservice wrapping RuBertToxicDetector (src/model_training/inference.py).

Loads trained weights from local disk (MODEL_DIR / MODEL_CHECKPOINT_PATH)
or downloads them automatically from Hugging Face Hub (HF_MODEL_REPO) on startup.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
import torch.nn as nn
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import AutoConfig, AutoModel, AutoTokenizer


class RuBertToxicDetector(nn.Module):
    def __init__(
        self,
        model_name: str = "DeepPavlov/rubert-base-cased",
        num_labels: int = 11,
        num_layers_pool: int = 4,
    ):
        super().__init__()
        self.config = AutoConfig.from_pretrained(model_name, output_hidden_states=True)
        self.rubert = AutoModel.from_pretrained(
            model_name, config=self.config, attn_implementation="eager"
        )
        self.num_layers_pool = num_layers_pool
        self.layer_weights = nn.Parameter(torch.ones(num_layers_pool))
        self.dropouts = nn.ModuleList([nn.Dropout(0.2) for _ in range(5)])
        self.classifier = nn.Linear(self.config.hidden_size, num_labels)

    def forward(self, input_ids, attention_mask):
        outputs = self.rubert(input_ids=input_ids, attention_mask=attention_mask)
        top_hidden_states = outputs.hidden_states[-self.num_layers_pool:]
        weights = torch.softmax(self.layer_weights, dim=0).view(-1, 1, 1, 1)
        stacked = torch.stack(top_hidden_states, dim=0)
        pooled_output = torch.sum(weights * stacked, dim=0)
        logits = torch.mean(
            torch.stack([self.classifier(drop(pooled_output)) for drop in self.dropouts], dim=0),
            dim=0,
        )
        return logits


class ToxicSpanPredictor:
    def __init__(self, ckpt_path: Path, device: Optional[str] = None):
        self.ckpt_path = ckpt_path
        self.model_dir = ckpt_path.parent
        self.tokenizer_dir = self.model_dir / "tokenizer"

        if not self.ckpt_path.exists():
            raise FileNotFoundError(
                f"Файл весов не найден: {self.ckpt_path.resolve()}. "
                "Скопируйте best_model.pt в python_inference/models/rubert_toxic_detector/ "
                "или задайте переменную MODEL_DIR / HF_MODEL_REPO."
            )

        self.device = torch.device(
            device if device else ("cuda" if torch.cuda.is_available() else "cpu")
        )

        checkpoint = torch.load(self.ckpt_path, map_location=self.device, weights_only=False)
        self.model_name = checkpoint.get("model_name", "DeepPavlov/rubert-base-cased")
        self.max_len = checkpoint.get("max_len", 256)
        self.epoch = checkpoint.get("epoch")
        self.val_metrics = checkpoint.get("val_metrics", {})
        self.id2label = {int(k): v for k, v in checkpoint["id2label"].items()}

        tokenizer_source = (
            str(self.tokenizer_dir) if self.tokenizer_dir.exists() else self.model_name
        )
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, use_fast=True)

        self.model = RuBertToxicDetector(
            model_name=self.model_name,
            num_labels=len(self.id2label),
        )
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.to(self.device)
        self.model.eval()

        macro_f1 = self.val_metrics.get("token_macro_f1")
        f1_info = f" | Val Macro F1: {macro_f1:.4f}" if isinstance(macro_f1, (int, float)) else ""
        print(
            f"[FastAPI] RuBertToxicDetector загружен ({self.device}, "
            f"ckpt={self.ckpt_path}, epoch={self.epoch}{f1_info})",
            flush=True,
        )

    @staticmethod
    def _finalize_entity(
        text: str, ent_data: Dict[str, Any], include_confidence: bool
    ) -> Dict[str, Any]:
        start, end = ent_data["start"], ent_data["end"]
        result: Dict[str, Any] = {
            "span": text[start:end],
            "start": start,
            "end": end,
            "category": ent_data["category"],
        }
        if include_confidence:
            avg_prob = sum(ent_data["probs"]) / len(ent_data["probs"])
            result["confidence"] = round(float(avg_prob), 4)
        return result

    @classmethod
    def _decode_tokens_to_spans(
        cls,
        text: str,
        offsets: List[List[int]],
        pred_ids: List[int],
        probs: List[float],
        id2label: Dict[int, str],
        include_confidence: bool = True,
    ) -> List[Dict[str, Any]]:
        entities = []
        current_ent = None

        for (start, end), pred_id, prob in zip(offsets, pred_ids, probs):
            if start == 0 and end == 0:
                continue

            tag = id2label[int(pred_id)]
            if tag == "O":
                if current_ent is not None:
                    entities.append(cls._finalize_entity(text, current_ent, include_confidence))
                    current_ent = None
                continue

            prefix, cat = tag.split("-", 1)
            if current_ent is not None:
                is_same_cat = current_ent["category"] == cat
                is_subword_continuation = start == current_ent["end"]
                if is_same_cat and (prefix == "I" or is_subword_continuation):
                    current_ent["end"] = end
                    current_ent["probs"].append(prob)
                else:
                    entities.append(cls._finalize_entity(text, current_ent, include_confidence))
                    current_ent = {"start": start, "end": end, "category": cat, "probs": [prob]}
            else:
                current_ent = {"start": start, "end": end, "category": cat, "probs": [prob]}

        if current_ent is not None:
            entities.append(cls._finalize_entity(text, current_ent, include_confidence))

        return entities

    @torch.no_grad()
    def predict_text(self, text: str, include_confidence: bool = True) -> Dict[str, Any]:
        encoding = self.tokenizer(
            [text],
            truncation=True,
            max_length=self.max_len,
            padding=True,
            return_offsets_mapping=True,
            return_tensors="pt",
        )
        input_ids = encoding["input_ids"].to(self.device)
        attention_mask = encoding["attention_mask"].to(self.device)
        offsets = encoding["offset_mapping"].tolist()[0]

        if self.device.type == "cuda":
            with torch.amp.autocast("cuda"):
                logits = self.model(input_ids=input_ids, attention_mask=attention_mask)
        else:
            logits = self.model(input_ids=input_ids, attention_mask=attention_mask)

        probabilities = torch.softmax(logits, dim=-1)
        max_probs, pred_ids = torch.max(probabilities, dim=-1)

        entities = self._decode_tokens_to_spans(
            text=text,
            offsets=offsets,
            pred_ids=pred_ids.cpu().tolist()[0],
            probs=max_probs.cpu().tolist()[0],
            id2label=self.id2label,
            include_confidence=include_confidence,
        )
        return {"id": 0, "text": text, "entities": entities}


def resolve_checkpoint_path() -> Path:
    explicit_ckpt = os.getenv("MODEL_CHECKPOINT_PATH", "").strip()
    if explicit_ckpt:
        return Path(explicit_ckpt)

    env_dir = os.getenv("MODEL_DIR", "").strip()
    candidates = []
    if env_dir:
        candidates.append(Path(env_dir))

    candidates.extend(
        [
            Path("models/rubert_toxic_detector"),
            Path("models/rubert-toxic-detector"),
            Path("../models/rubert_toxic_detector"),
            Path("../models/rubert-toxic-detector"),
        ]
    )

    for folder in candidates:
        ckpt = folder / "best_model.pt"
        if ckpt.exists():
            return ckpt

    hf_repo = os.getenv("HF_MODEL_REPO", "").strip()
    target_dir = Path(env_dir) if env_dir else Path("models/rubert_toxic_detector")
    if hf_repo:
        from huggingface_hub import snapshot_download

        print(f"[FastAPI] Загрузка весов из Hugging Face Hub: {hf_repo}", flush=True)
        downloaded = snapshot_download(
            repo_id=hf_repo,
            token=os.getenv("HF_TOKEN") or None,
            local_dir=str(target_dir),
        )
        return Path(downloaded) / "best_model.pt"

    return target_dir / "best_model.pt"


MODEL_VERSION = os.getenv("MODEL_VERSION", "rubert-toxic-detector-v1")
MODEL_API_SECRET = os.getenv("MODEL_API_SECRET", "").strip()

predictor: Optional[ToxicSpanPredictor] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global predictor
    ckpt_path = resolve_checkpoint_path()
    predictor = ToxicSpanPredictor(ckpt_path=ckpt_path)
    yield
    predictor = None


app = FastAPI(
    title="RuBERT Toxic Span Inference API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_secret(authorization: Optional[str] = Header(default=None)) -> None:
    if not MODEL_API_SECRET:
        return
    expected = f"Bearer {MODEL_API_SECRET}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


class PredictRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    include_confidence: bool = True


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok" if predictor is not None else "loading",
        "model_version": MODEL_VERSION,
        "device": str(predictor.device) if predictor else None,
        "epoch": predictor.epoch if predictor else None,
        "val_metrics": predictor.val_metrics if predictor else None,
    }


@app.post("/predict", dependencies=[Depends(verify_secret)])
def predict(req: PredictRequest) -> Dict[str, Any]:
    if predictor is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet")
    result = predictor.predict_text(req.text, include_confidence=req.include_confidence)
    result["model_version"] = MODEL_VERSION
    return result
