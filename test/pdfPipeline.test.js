const test = require('node:test');
const assert = require('node:assert/strict');
const { convertPdfItemsToMarkdown, extractStructuredPages, analyzeDocumentProfile } = require('../pdfPipeline');

function page(width, height, lines) {
  return {
    width,
    height,
    items: lines.map((l) => ({
      str: l.text,
      transform: [l.font || 10, 0, 0, l.height || 10, l.x, l.y],
      width: l.width,
      height: l.height || 10,
      fontName: l.fontName || '',
    })),
  };
}

test('single-column article keeps heading and body separate', () => {
  const md = convertPdfItemsToMarkdown([
    page(600, 800, [
      { text: 'Introduction', x: 80, y: 740, width: 150, font: 14, fontName: 'Bold' },
      { text: 'This is the first line of a paragraph', x: 80, y: 710, width: 360 },
      { text: 'that continues naturally.', x: 80, y: 696, width: 220 },
    ]),
  ]);
  assert.match(md, /## Introduction/);
  assert.match(md, /This is the first line of a paragraph that continues naturally\./);
});

test('two-column order is left column then right column without interleaving', () => {
  const md = convertPdfItemsToMarkdown([
    page(800, 1000, [
      { text: 'L1', x: 80, y: 900, width: 220 },
      { text: 'L2', x: 80, y: 870, width: 220 },
      { text: 'L3', x: 80, y: 840, width: 220 },
      { text: 'R1', x: 460, y: 900, width: 220 },
      { text: 'R2', x: 460, y: 870, width: 220 },
      { text: 'R3', x: 460, y: 840, width: 220 },
      { text: 'L4', x: 80, y: 810, width: 220 },
      { text: 'R4', x: 460, y: 810, width: 220 },
      { text: 'L5', x: 80, y: 780, width: 220 },
      { text: 'R5', x: 460, y: 780, width: 220 },
      { text: 'L6', x: 80, y: 750, width: 220 },
      { text: 'R6', x: 460, y: 750, width: 220 },
    ]),
  ]);
  assert.ok(md.indexOf('L1') < md.indexOf('L6'));
  assert.ok(md.indexOf('L6') < md.indexOf('R1'));
});

test('references are preserved as separate entries and URL retained', () => {
  const md = convertPdfItemsToMarkdown([
    page(700, 900, [
      { text: 'References', x: 90, y: 820, width: 180, font: 14, fontName: 'Bold' },
      { text: '[1] Doe, J. (2020). Example.', x: 90, y: 790, width: 220 },
      { text: 'https://example.com/a', x: 90, y: 776, width: 220 },
      { text: '[2] Roe, R. (2021). Another.', x: 380, y: 790, width: 220 },
      { text: 'https://example.com/b', x: 380, y: 776, width: 220 },
      { text: 'L3', x: 90, y: 740, width: 220 },
      { text: 'R3', x: 380, y: 740, width: 220 },
      { text: 'L4', x: 90, y: 720, width: 220 },
      { text: 'R4', x: 380, y: 720, width: 220 },
      { text: 'L5', x: 90, y: 700, width: 220 },
      { text: 'R5', x: 380, y: 700, width: 220 },
      { text: 'L6', x: 90, y: 680, width: 220 },
      { text: 'R6', x: 380, y: 680, width: 220 },
      { text: 'Page 9', x: 330, y: 40, width: 60 },
    ]),
  ]);
  assert.match(md, /## References/);
  assert.match(md, /- \[1\].*https:\/\/example.com\/a/);
  assert.match(md, /- \[2\].*https:\/\/example.com\/b/);
  assert.doesNotMatch(md, /Page 9/);
});

test('repeated headers and footers are suppressed across pages', () => {
  const pages = [1, 2, 3].map((n) =>
    page(700, 900, [
      { text: 'Journal of Testing 2024', x: 200, y: 870, width: 220 },
      { text: `Body page ${n}`, x: 90, y: 700, width: 220 },
      { text: `${n}`, x: 340, y: 30, width: 20 },
    ]),
  );
  const md = convertPdfItemsToMarkdown(pages);
  assert.doesNotMatch(md, /Journal of Testing/);
  assert.match(md, /Body page 1/);
  assert.match(md, /Body page 3/);
});

test('bilingual parallel abstract columns are not braided', () => {
  const md = convertPdfItemsToMarkdown([
    page(800, 950, [
      { text: 'Abstract', x: 90, y: 880, width: 160, font: 13, fontName: 'Bold' },
      { text: 'English sentence one.', x: 90, y: 840, width: 260 },
      { text: 'English sentence two.', x: 90, y: 820, width: 260 },
      { text: 'Resumen', x: 450, y: 880, width: 160, font: 13, fontName: 'Bold' },
      { text: 'Oracion en español uno.', x: 450, y: 840, width: 260 },
      { text: 'Oracion en español dos.', x: 450, y: 820, width: 260 },
      { text: 'L3', x: 90, y: 780, width: 260 },
      { text: 'R3', x: 450, y: 780, width: 260 },
      { text: 'L4', x: 90, y: 760, width: 260 },
      { text: 'R4', x: 450, y: 760, width: 260 },
      { text: 'L5', x: 90, y: 740, width: 260 },
      { text: 'R5', x: 450, y: 740, width: 260 },
    ]),
  ]);
  assert.ok(md.indexOf('English sentence one.') < md.indexOf('Oracion en español uno.'));
  assert.doesNotMatch(md, /English sentence one\. Oracion en español uno\./);
});

test('license/sidebar/footer content stays out of body', () => {
  const md = convertPdfItemsToMarkdown([
    page(700, 900, [
      { text: 'Main body starts here.', x: 90, y: 760, width: 320 },
      { text: 'Sidebar citation box text that should not merge into body text at all.', x: 500, y: 740, width: 120 },
      { text: 'Creative Commons Attribution License', x: 120, y: 45, width: 300 },
    ]),
  ]);
  assert.match(md, /Main body starts here\./);
  assert.doesNotMatch(md, /Creative Commons/);
});

test('mixed layout first page full-width then two-column later pages', () => {
  const md = convertPdfItemsToMarkdown([
    page(700, 900, [
      { text: 'Title of Paper', x: 150, y: 840, width: 300, font: 16, fontName: 'Bold' },
      { text: 'Intro paragraph line one.', x: 90, y: 780, width: 420 },
      { text: 'Intro paragraph line two.', x: 90, y: 760, width: 420 },
    ]),
    page(800, 1000, [
      { text: 'Left later page', x: 80, y: 900, width: 250 },
      { text: 'Right later page', x: 460, y: 900, width: 250 },
      { text: 'L2', x: 80, y: 860, width: 250 },
      { text: 'R2', x: 460, y: 860, width: 250 },
      { text: 'L3', x: 80, y: 820, width: 250 },
      { text: 'R3', x: 460, y: 820, width: 250 },
      { text: 'L4', x: 80, y: 780, width: 250 },
      { text: 'R4', x: 460, y: 780, width: 250 },
      { text: 'L5', x: 80, y: 740, width: 250 },
      { text: 'R5', x: 460, y: 740, width: 250 },
      { text: 'L6', x: 80, y: 700, width: 250 },
      { text: 'R6', x: 460, y: 700, width: 250 },
    ]),
  ]);
  assert.match(md, /Title of Paper/);
  assert.ok(md.indexOf('Left later page') < md.indexOf('Right later page'));
});

test('paragraph buffer resets and does not duplicate incrementally', () => {
  const md = convertPdfItemsToMarkdown([
    page(700, 900, [
      { text: 'First paragraph line one.', x: 90, y: 760, width: 300 },
      { text: 'First paragraph line two.', x: 90, y: 744, width: 300 },
      { text: 'Second paragraph line one.', x: 90, y: 680, width: 300 },
      { text: 'Second paragraph line two.', x: 90, y: 664, width: 300 },
    ]),
  ]);
  const count = (md.match(/First paragraph line one\./g) || []).length;
  assert.equal(count, 1);
  assert.doesNotMatch(md, /First paragraph line one\..*First paragraph line one\./);
});

test('extractStructuredPages returns one entry per page with text and headings', () => {
  const pages = extractStructuredPages([
    page(600, 800, [
      { text: 'Introduction', x: 80, y: 740, width: 150, font: 14, fontName: 'Bold' },
      { text: 'This is the first line of a paragraph', x: 80, y: 710, width: 360 },
      { text: 'that continues naturally.', x: 80, y: 696, width: 220 },
    ]),
    page(600, 800, [
      { text: 'Methods', x: 80, y: 740, width: 150, font: 14, fontName: 'Bold' },
      { text: 'Second page body text here.', x: 80, y: 710, width: 360 },
    ]),
  ]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].page, 1);
  assert.ok(pages[0].headings.includes('Introduction'));
  assert.match(pages[0].text, /Introduction/);
  assert.match(pages[0].text, /This is the first line of a paragraph that continues naturally\./);
  assert.ok(pages[0].char_count > 0);
  assert.equal(pages[1].page, 2);
  assert.ok(pages[1].headings.includes('Methods'));
  assert.match(pages[1].text, /Second page body text here\./);
});

test('extractStructuredPages suppresses repeated furniture across pages', () => {
  const rawPages = [1, 2, 3].map((n) =>
    page(700, 900, [
      { text: 'Running Header', x: 200, y: 870, width: 220 },
      { text: `Body page ${n}`, x: 90, y: 700, width: 220 },
      { text: `${n}`, x: 340, y: 30, width: 20 },
    ]),
  );
  const pages = extractStructuredPages(rawPages);
  assert.equal(pages.length, 3);
  for (const p of pages) {
    assert.doesNotMatch(p.text, /Running Header/);
  }
  assert.match(pages[0].text, /Body page 1/);
  assert.match(pages[2].text, /Body page 3/);
});

test('extractStructuredPages returns empty text for pages with only furniture', () => {
  const pages = extractStructuredPages([
    page(600, 800, [
      { text: 'Page 1', x: 280, y: 20, width: 40 },
    ]),
  ]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].text, '');
  assert.equal(pages[0].char_count, 0);
});


test('preflight classifier marks glyphless-heavy content as ocr-overlay', () => {
  const profile = analyzeDocumentProfile([
    page(600, 800, [
      { text: 'A noisy title', x: 80, y: 740, width: 150, fontName: 'GlyphLessFont' },
      { text: '%%% ####', x: 80, y: 710, width: 120, fontName: 'GlyphLessFont' },
      { text: 'withveryveryverylongmergedtoken', x: 80, y: 690, width: 220, fontName: 'GlyphLessFont' },
    ]),
  ]);
  assert.equal(profile.classification, 'ocr-overlay');
  assert.ok(profile.reasons.includes('glyphless_font_layer'));
});

test('ocr-overlay routing demotes short false headings', () => {
  const md = convertPdfItemsToMarkdown([
    page(700, 900, [
      { text: 'IX', x: 90, y: 850, width: 30, font: 18, fontName: 'GlyphLessFont Bold' },
      { text: 'This is body text under a noisy short heading.', x: 90, y: 810, width: 420, fontName: 'GlyphLessFont' },
    ]),
  ]);
  assert.doesNotMatch(md, /## IX/);
  assert.match(md, /IX\s+This is body text under a noisy short heading\./);
});
test('block ordering keeps top matter before two-column body and footer after', () => {
  const md = convertPdfItemsToMarkdown([
    page(900, 1200, [
      { text: 'Paper Title', x: 240, y: 1120, width: 420, font: 22, fontName: 'Bold' },
      { text: 'Author Name', x: 300, y: 1085, width: 220, font: 14 },
      { text: 'L1 body', x: 90, y: 960, width: 280 },
      { text: 'L2 body', x: 90, y: 930, width: 280 },
      { text: 'L3 body', x: 90, y: 900, width: 280 },
      { text: 'R1 body', x: 520, y: 960, width: 280 },
      { text: 'R2 body', x: 520, y: 930, width: 280 },
      { text: 'R3 body', x: 520, y: 900, width: 280 },
      { text: 'Conclusion line.', x: 120, y: 120, width: 620 },
    ]),
  ]);
  assert.ok(md.indexOf('Paper Title') < md.indexOf('L1 body'));
  assert.ok(md.indexOf('R3 body') < md.indexOf('Conclusion line.'));
});
