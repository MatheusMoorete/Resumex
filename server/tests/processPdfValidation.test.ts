import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DocumentIRSchema } from '../src/schemas/documentIr.js';
import { documentIrToLegacyPages } from '../summaryJobs.js';

describe('Python process_pdf.py CLI Output Validation against Node DocumentIRSchema', () => {
  it('should generate valid Document IR JSON from CLI execution and validate against Zod schema', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumex-cli-test-'));
    const inputPdf = path.join(tmpDir, 'sample-test.pdf');
    const outputJson = path.join(tmpDir, 'document-ir.json');
    const artifactsDir = path.join(tmpDir, 'artifacts');

    const pyScript = `
import pymupdf as fitz

doc = fitz.open()
page = doc.new_page(width=600, height=800)
page.insert_text((50, 50), "Aspectos Históricos do SUS", fontsize=22)
page.insert_text((50, 100), "Em 1923, a Lei Eloy Chaves criou as Caixas de Aposentadoria e Pensões (CAPs).", fontsize=12)

rect = fitz.Rect(50, 150, 300, 170)
annot = page.add_highlight_annot(rect)
annot.set_info({"content": "Destaque crítico"})
annot.update()

doc.save(r"${inputPdf.replace(/\\/g, '\\\\')}")
doc.close()
`;

    const pythonBin = process.platform === 'win32' ? 'py' : 'python3';
    execFileSync(pythonBin, ['-c', pyScript], { encoding: 'utf-8' });

    execFileSync(
      pythonBin,
      [
        'worker/process_pdf.py',
        '--input',
        inputPdf,
        '--output',
        outputJson,
        '--artifacts-dir',
        artifactsDir,
        '--document-id',
        'doc-cli-uuid-12345',
        '--schema-version',
        '1.0.0',
      ],
      { encoding: 'utf-8' }
    );

    expect(fs.existsSync(outputJson)).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'manifest.json'))).toBe(true);

    const rawJson = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
    const parsedDocIR = DocumentIRSchema.parse(rawJson);

    expect(parsedDocIR.schemaVersion).toBe('1.0.0');
    expect(parsedDocIR.documentId).toBe('doc-cli-uuid-12345');
    expect(parsedDocIR.pageCount).toBe(1);
    expect(parsedDocIR.pages[0].blocks.length).toBeGreaterThanOrEqual(3);

    const legacyPages = documentIrToLegacyPages(parsedDocIR, artifactsDir, 'sample-test.pdf', {
      handwritingMode: 'all',
      manualVisionPages: [],
    });
    expect(legacyPages).toHaveLength(1);
    expect(legacyPages[0]).toMatchObject({
      page: 1,
      sourceName: 'sample-test.pdf',
      sourcePage: 1,
      needsVision: true,
    });
    expect(legacyPages[0].imagePath).toBe(path.join(artifactsDir, 'pages', 'page-0001-preview.jpg'));
    expect(legacyPages[0].blocks.every((block) => block.bbox.every((value) => value >= 0 && value <= 1))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 15_000);
});
