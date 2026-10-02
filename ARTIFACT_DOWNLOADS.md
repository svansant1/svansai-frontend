# Chat attachments

This update belongs to the original svansai-frontend website, not SVANS Agent V3.

## Supported output

- Word .docx with native tables, headings, paragraphs, bullet and numbered lists, page breaks, running headers/footers, page numbers and restrained font/color themes.
- PowerPoint .pptx with explicit slide ordering, editable text and tables, speaker notes, color/font themes and overflow continuation slides.
- Excel .xlsx with multiple sheets, real formula cells and relative formula fills, dropdowns and numeric validation, input/output styling, number formats, conditional formatting, merged titles, frozen rows and filters.
- CSV, Markdown and plain text downloads.
- OpenAI picture generation and editing of newly attached PNG/JPEG/WebP images; portrait/landscape/square requests, transparency, PNG/JPEG/WebP output and high-quality requests.

The API returns actual file bytes, a MIME type and filename. The chat prepares a Blob download. Office files are native Office packages, not text with a renamed extension. This is one generated file/image per request. Macros, native charts/pivots, arbitrary embedded assets, image-filled decks, PDF output and pixel-perfect document conversion are not implemented. Unknown schema fields or unsupported requested features must fail explicitly, not produce a misleading substitute.

Model-generated Office files use validated JSON specifications. Plain supplied content and simple prior-answer exports retain the older Markdown/CSV paths. CSV cells beginning with = remain literal strings; only explicit validated workbook formula properties become executable Excel formulas. Network/DDE functions, external links, named expressions, dynamic references and cycles are blocked. Syntax/security validation is not a universal proof of formula correctness: review generated calculations. Excel is instructed to recalculate on open; the website does not calculate cached results server-side.

Workbook limits: 8 sheets, 5,000 rows and 100 columns per sheet, 50,000 expanded cells, 5,000 formulas, 100,000 source JSON characters. Decks are limited to 100 slides including continuations. A table row that cannot fit safely is rejected. Image edits accept up to four PNG/JPEG/WebP source images, each at most 10 MB, attached to the current request. JPEG requests with transparency use PNG because JPEG cannot preserve alpha. Previously generated chat images are not automatically reattached for edits.

## Try it

- Create a Word document about firewall basics.
- Create a PowerPoint about safe passwords.
- Create an Excel budget template.
- Put your previous answer into a Word document.
- Generate a picture of a blue robot in a workshop.
- Create an interactive Excel workbook with editable inputs, formulas, dropdowns and a summary sheet. Do not create a static table.
- Create a Word report with a native findings table, numbered recommendations and page numbers.
- Create a PowerPoint with editable tables and speaker notes.
- Edit this attached image to have a transparent background as PNG.

For a deterministic export without a model call, send:

    Create an Excel workbook titled "Equipment"
    Content:
    Item,Quantity
    Router,2
    Switch,1

The instruction must explicitly ask to create/export a supported file. A question such as "How do I create a PowerPoint?" remains normal chat. Negative design constraints ("Do not create a static reference table") no longer cancel an affirmative file request. Genuine cancellations are still respected.

## Providers and bounds

Document drafting uses a configured provider: OpenAI first when available, then Gemini, then Anthropic. SVANSAI_ARTIFACT_PROVIDER can explicitly select openai, gemini or anthropic, and SVANSAI_ARTIFACT_MODEL optionally selects that provider's model. There is no automatic fallback to another vendor after a generation failure. Pictures require OPENAI_API_KEY and image-generation access. Existing image model/format settings still apply.

File generation accepts up to five readable source attachments. CSV/TSV/text input is read in full within the bounds, not reduced to sample rows. DOCX body text, embedded PDF text, and XLSX cell values across all sheets are extracted with explicit limits; oversized inputs are rejected instead of silently truncated. Source workbooks are limited to 50,000 cells across their used ranges and PDFs to 100 pages. Office/PDF import is text-only: original layout, embedded images, headers/footers and charts are not preserved, and formulas are not recalculated. PDFs with pages lacking embedded text are rejected rather than partially exported. Images are generated separately; picture-to-document visual analysis is not claimed. Limit: 100,000 source/content characters and 8 MB per Office/text download. The existing chat endpoint limits individual pasted messages to 30,000 characters; attach a source file for larger content. Large tables and decks have additional explicit bounds. CSV formulas are neutralized as literal text; XLSX strings are not promoted to executable formulas. Truncated provider responses are rejected rather than presented as complete documents.

Conversion routing distinguishes the requested output from the input: "Create a PowerPoint from this Word document" creates PPTX, and "Save this Excel workbook as CSV" creates CSV. These are content-generation/export tools, not pixel-perfect Office file converters. Review generated drafts and data before using them.

Saved assistant downloads are encoded within the existing private conversation_messages.content column and decoded when chats load. No SQL migration or public download bucket is required. Older clients will not understand this new envelope; deploy the frontend and API together. File bytes are excluded from later model prompts. Local/browser storage limits and existing conversation RLS still apply.

## Verification and deployment

October 2, 2026: 21 artifact/source/advanced regression tests pass, including the supplied Hi-Lo request routed through a mocked structured draft. The acceptance workbook contains six rounds with separate blank card-entry cells and real formulas. An independent bundled spreadsheet engine verified recalculation for blank inputs, numeric/face ranks, a changed card, cumulative rounds, invalid entries, exhausted shoe and reset. This tests the export engine and fixture, not a live provider's response to that prompt. TypeScript and production build passed. HTTP smoke checks cover both chat endpoints with native files and API authentication. Image generation/editing were tested with mocked responses; live paid providers, authenticated Supabase save/restore, browser download clicks and native Office visual rendering were not exercised.

The image-option implementation follows [official OpenAI image prompting documentation](https://developers.openai.com/api/docs/guides/image-prompting). Existing provider/model configuration is retained. Artifact drafting permits up to 8,192 output tokens with a 120-second provider timeout; ensure the hosting request timeout allows that duration. No vendor fallback occurs after a failed file-generation call.

Dependency maintenance removed the previously reported critical Next.js alert and updated compatible Axios and related transitive dependencies. The production dependency audit still reports two high-severity package entries: image-size and its parent pptxgenjs. This exporter currently produces text-only slides and does not submit uploaded images to that parser. The advisory is not considered resolved; a compatible upstream fix or separately verified dependency replacement is still needed. No forced major-version dependency changes were applied.

Run:

    npm run test:artifacts
    npm run build
    npm run test:artifact-http

Commit/push and deploy this frontend to the existing hosting service to enable the change on svansai.com. This coding pass did not deploy, publish an installer, change live credentials or modify the new V3 project.
