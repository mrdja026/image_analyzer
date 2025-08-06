# 🧠 OCR-to-Summary CLI + Web Demo: TODO List

## ✅ Phase 1 – CLI & Role System

- [ ] Refactor CLI to accept `--role` param (e.g. `--role=seo-specialist`)
- [ ] Define role-to-prompt mappings in a config file or object
- [ ] Add fallback to default prompt if custom not passed
- [ ] Test CLI with:
  - [ ] Product Owner
  - [ ] Marketing Manager
  - [ ] SEO Specialist
  - [ ] Technical Writer
  - [ ] UX Designer
  - [ ] QA Tester
  - [ ] Data Analyst
  - [ ] Legal Advisor
- [ ] Add optional `--prompt` to override default per role
- [ ] Clean up CLI help / usage info

---

## ✅ Phase 2 – Web API Wrapper (Node.js)

- [ ] Expose image upload + role selection via REST
- [ ] Accept base64 or multipart image in POST
- [ ] Run OCR → send extracted text + role to summarizer
- [ ] Return structured JSON: `{ ocrText, role, summary }`

---

## ✅ Phase 3 – Frontend UI (One Page App)

- [ ] Design UI layout: image upload + role dropdown + result preview
- [ ] Implement image upload to REST API
- [ ] Add role picker with pre-filled roles/prompts
- [ ] Display extracted OCR and summary nicely
- [ ] Style with Tailwind, responsive layout
- [ ] Add loading + error handling

---

## ✅ Phase 4 – Deployment

- [ ] Dockerize full stack (Ollama + Node API + UI)
- [ ] Push to Docker Hub
- [ ] Deploy to RunPod with public endpoint
- [ ] Test with real screenshots/images
- [ ] (Optional) Track usage/demo stats