# JARVIS LoRA Training (Desktop GPU only)

Human-gated fine-tuning pipeline for personal style and tool-use patterns.

## Prerequisites

- NVIDIA GPU with 8GB+ VRAM
- Python 3.10+
- Reviewed JSONL from `npm run export-feedback`

## Setup

```bash
cd scripts/train-lora
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

## Train (requires explicit confirmation)

```bash
python train.py --input ../../data/feedback-export.jsonl --confirm
```

Output: `models/adapters/jarvis-YYYY-MM-DD/`

## Activate adapter (second confirmation)

```bash
node scripts/activate-adapter.js --path models/adapters/jarvis-YYYY-MM-DD --confirm
```

Updates Ollama Modelfile and `llm-routing.config.json` personal route.

## Rollback

```bash
node scripts/activate-adapter.js --rollback
```

## Expectations

- Improves tone, formatting, preference phrases
- Does NOT replace frontier models for complex coding/reasoning
- Train only on local machine — never upload raw logs to cloud
