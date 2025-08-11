Keep OCR model only for chunk extraction
Use the OCR Modelfile strictly to transcribe image chunks to plain text.
No analysis/combination with the vision model.
Combine via deterministic text merge (preferred)
Order chunks by their position (y, then x).
Split each chunk into lines; maintain a rolling window of recent lines.
For each new chunk, remove overlaps by suffix/prefix line matching and simple fuzzy similarity (e.g., Jaccard/Levenshtein) with thresholds.
Preserve original order and line breaks; never add content.
Enforce an expansion cap: final length ≤ k × sum(input lengths (e.g., 1.1×)); if exceeded, tighten overlap threshold.
If you still want an LLM to combine
Use the text model (not VLM) with a strict “merge only, no new text” prompt.
Temperature 0.0, small top_p/top_k; add STOP terms that catch narrative.
Enforce expansion ratio; if violated, fall back to deterministic merge.
Quality gates
Before combine: drop chunks with low alphanumeric ratio or narrative markers.
After combine: if markers appear or expansion cap is exceeded, re-run or use deterministic merge.
Telemetry
Log per-chunk length, overlap removals, and whether deterministic fallback triggered.
Log final length vs sum of inputs.
i thought llm was combinig, how is that happenmig explain it to me 

LLM is combining in the text stage, not the OCR stage.
Chunk OCR
Each image chunk is sent to the vision model (VLM) to transcribe text only.
Combine (LLM)
All chunk texts are concatenated into a prompt and sent to the text model (LLM) with the combine prompt. That LLM produces the merged document; streaming shows high tokens/sec.
Why it can drift or be fast
The combine uses the text LLM, which may rephrase/expand unless the prompt/params are strict.
Streaming is enabled, so token rate (TPS) appears “insane” during the combine generation.
If you want LLM to strictly merge without adding content, we can tighten the combine prompt/params or switch to a deterministic (non-LLM) merge.
The combine is handled by the text LLM; each chunk’s OCR is handled by the vision model.