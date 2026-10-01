# Chat attachments

This update belongs to the original svansai-frontend website, not SVANS Agent V3.

## Supported output

- Word .docx with paragraphs, headings and bullets.
- PowerPoint .pptx slides, paginated instead of silently dropping sections.
- Excel .xlsx with a frozen header, typed numeric values and preserved quoted/empty cells.
- CSV, Markdown and plain text downloads.
- Existing OpenAI picture generation, now accepting polite requests such as "Can you create a picture of a robot?"

The API returns actual file bytes, a MIME type and filename. The chat prepares a Blob download. Office files are real ZIP-based Office packages, not text with a renamed extension. This is one generated file per request; complex charts, macros, multiple worksheets and image-filled decks are not implemented by these simple exporters.

## Try it

- Create a Word document about firewall basics.
- Create a PowerPoint about safe passwords.
- Create an Excel budget template.
- Put your previous answer into a Word document.
- Generate a picture of a blue robot in a workshop.

For a deterministic export without a model call, send:

    Create an Excel workbook titled "Equipment"
    Content:
    Item,Quantity
    Router,2
    Switch,1

The instruction must explicitly ask to create/export a supported file. A question such as "How do I create a PowerPoint?" remains normal chat.

## Providers and bounds

Document drafting uses a configured provider: OpenAI first when available, then Gemini, then Anthropic. SVANSAI_ARTIFACT_PROVIDER can explicitly select openai, gemini or anthropic, and SVANSAI_ARTIFACT_MODEL optionally selects that provider's model. There is no automatic fallback to another vendor after a generation failure. Pictures require OPENAI_API_KEY and image-generation access. Existing image model/format settings still apply.

File generation accepts up to five readable source attachments. CSV/TSV/text input is read in full within the bounds, not reduced to sample rows. DOCX body text, embedded PDF text, and XLSX cell values across all sheets are extracted with explicit limits; oversized inputs are rejected instead of silently truncated. Source workbooks are limited to 50,000 cells across their used ranges and PDFs to 100 pages. Office/PDF import is text-only: original layout, embedded images, headers/footers and charts are not preserved, and formulas are not recalculated. PDFs with pages lacking embedded text are rejected rather than partially exported. Images are generated separately; picture-to-document visual analysis is not claimed. Limit: 100,000 source/content characters and 8 MB per Office/text download. The existing chat endpoint limits individual pasted messages to 30,000 characters; attach a source file for larger content. Large tables and decks have additional explicit bounds. CSV formulas are neutralized as literal text; XLSX strings are not promoted to executable formulas. Truncated provider responses are rejected rather than presented as complete documents.

Conversion routing distinguishes the requested output from the input: "Create a PowerPoint from this Word document" creates PPTX, and "Save this Excel workbook as CSV" creates CSV. These are content-generation/export tools, not pixel-perfect Office file converters. Review generated drafts and data before using them.

Saved assistant downloads are encoded within the existing private conversation_messages.content column and decoded when chats load. No SQL migration or public download bucket is required. Older clients will not understand this new envelope; deploy the frontend and API together. File bytes are excluded from later model prompts. Local/browser storage limits and existing conversation RLS still apply.

## Verification and deployment

October 1, 2026: all 14 artifact/source regression tests passed; TypeScript and production build passed. The production HTTP smoke test verified /api/chat and authenticated /api/v1/chat return native DOCX/PPTX/XLSX bytes using supplied content with external fetches blocked, and that the API rejects missing credentials. Image generation was verified with a mocked PNG response. Live paid providers, authenticated Supabase save/restore, browser download clicks and Office desktop rendering were not exercised.

Dependency maintenance removed the previously reported critical Next.js alert and updated compatible Axios and related transitive dependencies. The production dependency audit still reports two high-severity package entries: image-size and its parent pptxgenjs. This exporter currently produces text-only slides and does not submit uploaded images to that parser. The advisory is not considered resolved; a compatible upstream fix or separately verified dependency replacement is still needed. No forced major-version dependency changes were applied.

Run:

    npm run test:artifacts
    npm run build
    npm run test:artifact-http

Commit/push and deploy this frontend to the existing hosting service to enable the change on svansai.com. This coding pass did not deploy, publish an installer, change live credentials or modify the new V3 project.
