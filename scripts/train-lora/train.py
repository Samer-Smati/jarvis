#!/usr/bin/env python3
"""QLoRA trainer for JARVIS personal adapter. Desktop GPU only."""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to feedback-export.jsonl")
    parser.add_argument("--base-model", default="unsloth/Llama-3.2-3B-Instruct-bnb-4bit")
    parser.add_argument("--confirm", action="store_true", help="Required to start training")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    if not args.confirm:
        print("Refusing to train without --confirm flag (human gate).", file=sys.stderr)
        sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    rows = load_jsonl(input_path)
    if len(rows) < 10:
        print(f"Need at least 10 examples, got {len(rows)}.", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.output or f"models/adapters/jarvis-{date.today().isoformat()}")
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        from unsloth import FastLanguageModel
        from trl import SFTTrainer
        from transformers import TrainingArguments
        from datasets import Dataset
    except ImportError:
        print("Install dependencies: pip install -r scripts/train-lora/requirements.txt", file=sys.stderr)
        sys.exit(1)

    texts = []
    for row in rows:
        msgs = row.get("messages", [])
        if len(msgs) >= 2:
            texts.append({"text": f"### User:\n{msgs[0]['content']}\n\n### Assistant:\n{msgs[1]['content']}"})

    dataset = Dataset.from_list(texts)

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=2048,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=2048,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            num_train_epochs=1,
            learning_rate=2e-4,
            output_dir=str(out_dir / "checkpoints"),
            logging_steps=10,
        ),
    )
    trainer.train()
    model.save_pretrained(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))

    (out_dir / "adapter-info.json").write_text(
        json.dumps({"base": args.base_model, "examples": len(texts), "date": date.today().isoformat()}, indent=2),
        encoding="utf-8",
    )
    print(f"Adapter saved to {out_dir}")

if __name__ == "__main__":
    main()
