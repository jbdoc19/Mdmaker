(function (global) {
  function normalizeText(value) {
    return (value || "")
      .normalize("NFC")
      .replaceAll("\u00A0", " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeFurnitureKey(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/\b\d+\b/g, "#")
      .replace(/[^\p{L}\p{N}# ]/gu, "")
      .trim();
  }

  function groupItemsIntoLines(items) {
    const sorted = [...items].sort((a, b) => {
      if (Math.abs(b.y - a.y) > 1) return b.y - a.y;
      return a.x - b.x;
    });
    const lines = [];

    for (const item of sorted) {
      const tolerance = Math.max(1.5, item.height * 0.65);
      let line = null;
      let bestDistance = Infinity;
      for (const candidate of lines) {
        const d = Math.abs(candidate.y - item.y);
        if (d <= tolerance && d < bestDistance) {
          bestDistance = d;
          line = candidate;
        }
      }
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    }

    return lines
      .flatMap((line) => {
        const words = [...line.items].sort((a, b) => a.x - b.x);
        if (!words.length) return [];
        const positiveGaps = [];
        for (let i = 1; i < words.length; i += 1) {
          const gap = words[i].x - (words[i - 1].x + words[i - 1].width);
          if (gap > 0) positiveGaps.push(gap);
        }
        const medianGap = positiveGaps.length
          ? positiveGaps.sort((a, b) => a - b)[Math.floor(positiveGaps.length / 2)]
          : 0;
        const avgFont = average(words.map((w) => w.fontSize)) || 10;
        const splitGap = medianGap > 0 ? Math.max(16, Math.min(90, medianGap * 1.25, avgFont * 2.2)) : 28;

        const segments = [];
        let current = [words[0]];
        for (let i = 1; i < words.length; i += 1) {
          const gap = words[i].x - (words[i - 1].x + words[i - 1].width);
          if (gap > splitGap) {
            segments.push(current);
            current = [words[i]];
          } else {
            current.push(words[i]);
          }
        }
        segments.push(current);

        return segments.map((segment) => {
          let text = "";
          for (let i = 0; i < segment.length; i += 1) {
            const word = segment[i];
            if (i > 0) {
              const prev = segment[i - 1];
              const gap = word.x - (prev.x + prev.width);
              text += gap > Math.max(3, prev.fontSize * 0.35) ? " " : "";
            }
            text += word.str;
          }
          const left = segment[0].x;
          const right = Math.max(...segment.map((w) => w.x + w.width));
          const fontSize = average(segment.map((w) => w.fontSize));
          const boldRatio =
            segment.filter((w) => /bold|black|heavy/i.test(w.fontName || "")).length /
            segment.length;

          return {
            text: normalizeText(text),
            y: line.y,
            left,
            right,
            width: right - left,
            center: (left + right) / 2,
            height: average(segment.map((w) => w.height)),
            fontSize,
            boldRatio,
          };
        });
      })
      .filter((line) => line.text);
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function nearestIndex(value, centers) {
    let idx = 0;
    let dist = Infinity;
    centers.forEach((center, i) => {
      const d = Math.abs(center - value);
      if (d < dist) {
        dist = d;
        idx = i;
      }
    });
    return idx;
  }

  function kMeans1D(values, k) {
    const sorted = [...values].sort((a, b) => a - b);
    let centers = Array.from({ length: k }, (_, i) => {
      const pos = Math.floor((i * (sorted.length - 1)) / Math.max(1, k - 1));
      return sorted[pos];
    });

    let assignments = Array.from({ length: k }, () => []);
    for (let it = 0; it < 14; it += 1) {
      assignments = Array.from({ length: k }, () => []);
      for (const v of sorted) {
        assignments[nearestIndex(v, centers)].push(v);
      }
      const next = centers.map((c, i) =>
        assignments[i].length ? average(assignments[i]) : c,
      );
      const movement = next.reduce((s, c, i) => s + Math.abs(c - centers[i]), 0);
      centers = next;
      if (movement < 0.5) break;
    }

    const overall = average(sorted);
    const within = assignments.reduce(
      (sum, group, i) =>
        sum + group.reduce((inner, v) => inner + (v - centers[i]) ** 2, 0),
      0,
    );
    const between = assignments.reduce(
      (sum, group, i) => sum + group.length * (centers[i] - overall) ** 2,
      0,
    );
    return { centers, assignments, within, between };
  }

  function detectColumns(lines, pageWidth) {
    if (lines.length < 10) return { count: 1, centers: [pageWidth / 2] };

    const candidates = lines.filter((l) => l.width < pageWidth * 0.72);
    if (candidates.length < 8) return { count: 1, centers: [pageWidth / 2] };

    let best = null;
    for (let k = 2; k <= 3; k += 1) {
      if (candidates.length < k * 4) continue;
      const km = kMeans1D(candidates.map((l) => l.center), k);
      const centers = [...km.centers].sort((a, b) => a - b);
      const minGap = Math.min(...centers.slice(1).map((c, i) => c - centers[i]));
      if (minGap < pageWidth * 0.14) continue;
      if (km.assignments.some((group) => group.length < 3)) continue;
      const score = km.between / Math.max(1, km.within);
      if (!best || score > best.score) best = { score, centers };
    }

    if (!best) return { count: 1, centers: [pageWidth / 2] };
    return { count: best.centers.length, centers: best.centers };
  }

  function classifyLine(line, ctx) {
    const text = line.text;
    const t = text.toLowerCase();
    const top = line.y > ctx.pageHeight * 0.96;
    const bottom = line.y < ctx.pageHeight * 0.06;

    if (/^(page\s+)?\d+(\s*(\/|of)\s*\d+)?$/i.test(text) && (top || bottom)) {
      return "page_number";
    }
    if (bottom && /license|creativecommons|copyright|all rights reserved|doi/i.test(t)) {
      return "license";
    }
    if (bottom || top) {
      if (text.length < 120) return "furniture";
    }
    if (/^references?\b/i.test(t)) return "references_heading";
    if (/^abstract\b/i.test(t)) return "abstract_heading";
    if (/^keywords?\b/i.test(t)) return "keywords_heading";
    if (/^doi\b|^received\b|^accepted\b|^published\b/i.test(t)) return "metadata";

    const isShort = text.split(/\s+/).length <= 14 && text.length <= 100;
    const looksHeadingText =
      /^(\d+(\.\d+)*\s+\S+|[ivx]+\.\s+\S+)/i.test(text) ||
      /^(introduction|methods?|results?|discussion|conclusion|background|materials and methods)\b/i.test(t);
    if (
      isShort &&
      !/[.!?]$/.test(text) &&
      (looksHeadingText || line.fontSize > ctx.bodyFontSize * 1.1 || line.boldRatio > 0.6)
    ) {
      return "heading";
    }

    if (line.width < ctx.pageWidth * 0.38 && text.length > 35) {
      return "sidebar";
    }

    return "body";
  }

  function analyzePage(items, pageWidth, pageHeight, pageIndex) {
    const normalized = items
      .filter((i) => i && typeof i.str === "string" && i.str.trim())
      .map((i) => ({
        str: normalizeText(i.str),
        x: i.transform?.[4] ?? 0,
        y: i.transform?.[5] ?? 0,
        width: i.width || 0,
        height: i.height || Math.abs(i.transform?.[3] || 10),
        fontSize: Math.abs(i.transform?.[0] || i.height || 10),
        fontName: i.fontName || "",
      }))
      .filter((i) => i.str);

    const lines = groupItemsIntoLines(normalized);
    const bodyFontSize = average(lines.map((l) => l.fontSize)) || 10;
    const columns = detectColumns(lines, pageWidth);

    return {
      pageIndex,
      pageWidth,
      pageHeight,
      bodyFontSize,
      columns,
      lines: lines.map((line) => {
        const column =
          columns.count === 1 || line.width > pageWidth * 0.82
            ? -1
            : nearestIndex(line.center, columns.centers);
        const region = classifyLine(line, {
          pageWidth,
          pageHeight,
          pageIndex,
          bodyFontSize,
        });
        return { ...line, region, column };
      }),
    };
  }

  function suppressRepeatedFurniture(pages) {
    if (pages.length < 2) return pages;
    const freq = new Map();
    for (const page of pages) {
      const seen = new Set();
      for (const line of page.lines) {
        if (!(line.region === "furniture" || line.region === "page_number")) continue;
        const key = normalizeFurnitureKey(line.text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    }
    const minRepeats = Math.max(2, Math.ceil(pages.length * 0.4));
    const repeated = new Set(
      [...freq.entries()].filter(([, count]) => count >= minRepeats).map(([k]) => k),
    );

    return pages.map((page) => ({
      ...page,
      lines: page.lines.filter((line) => {
        if (!(line.region === "furniture" || line.region === "page_number")) return true;
        const key = normalizeFurnitureKey(line.text);
        return key && !repeated.has(key);
      }),
    }));
  }

  function shouldBreakParagraph(current, next) {
    if (!next) return true;
    if (current.column !== next.column || current.region !== next.region) return true;
    const gap = current.y - next.y;
    if (gap > Math.max(current.height, next.height) * 1.85) return true;
    if (/[.!?)]$/.test(current.text) && /^[A-Z0-9"(]/.test(next.text)) return true;
    if (/-$/.test(current.text)) return false;
    return false;
  }

  function mergeLines(buffer) {
    if (!buffer.length) return "";
    return buffer
      .map((line, i) => {
        if (i === 0) return line.text;
        const prev = buffer[i - 1].text;
        if (/-$/.test(prev)) return line.text;
        return ` ${line.text}`;
      })
      .join("")
      .replace(/-\s+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }


  function clusterByVerticalBands(lines) {
    if (lines.length <= 1) return [{ minY: -Infinity, maxY: Infinity, lines: [...lines] }];
    const sorted = [...lines].sort((a, b) => b.y - a.y);
    const gaps = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const gap = sorted[i].y - sorted[i + 1].y;
      gaps.push({ idx: i, gap });
    }

    const avgHeight = average(sorted.map((l) => l.height || 10)) || 10;
    const minSplitGap = Math.max(26, avgHeight * 2.2);
    const splitPoints = gaps
      .filter((g) => g.gap >= minSplitGap)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3)
      .map((g) => g.idx)
      .sort((a, b) => a - b);

    const bands = [];
    let start = 0;
    for (const splitIdx of splitPoints) {
      const part = sorted.slice(start, splitIdx + 1);
      if (part.length) {
        bands.push({
          minY: part[part.length - 1].y,
          maxY: part[0].y,
          lines: part,
        });
      }
      start = splitIdx + 1;
    }
    const tail = sorted.slice(start);
    if (tail.length) {
      bands.push({ minY: tail[tail.length - 1].y, maxY: tail[0].y, lines: tail });
    }
    return bands.length ? bands : [{ minY: -Infinity, maxY: Infinity, lines: sorted }];
  }

  function orderBandLines(lines, columnCount) {
    if (columnCount <= 1) return [...lines].sort((a, b) => b.y - a.y || a.left - b.left);

    const standalone = [];
    const byColumn = Array.from({ length: columnCount }, () => []);

    for (const line of lines) {
      if (line.column === -1 || line.width > 0.82 * (line.pageWidth || Infinity)) {
        standalone.push(line);
      } else if (line.column >= 0 && line.column < columnCount) {
        byColumn[line.column].push(line);
      } else {
        standalone.push(line);
      }
    }

    standalone.sort((a, b) => b.y - a.y || a.left - b.left);
    byColumn.forEach((group) => group.sort((a, b) => b.y - a.y || a.left - b.left));

    const highestColumnTop = byColumn.some((g) => g.length)
      ? Math.max(...byColumn.map((g) => (g[0] ? g[0].y : -Infinity)))
      : -Infinity;
    const lowestColumnBottom = byColumn.some((g) => g.length)
      ? Math.min(...byColumn.map((g) => (g[g.length - 1] ? g[g.length - 1].y : Infinity)))
      : Infinity;

    const top = standalone.filter((line) => line.y > highestColumnTop);
    const mid = standalone.filter((line) => line.y <= highestColumnTop && line.y >= lowestColumnBottom);
    const bottom = standalone.filter((line) => line.y < lowestColumnBottom);

    return [...top, ...byColumn.flatMap((g) => g), ...mid, ...bottom];
  }

  function assembleReferences(lines) {
    const byColumn = new Map();
    for (const line of lines) {
      const key = line.column >= 0 ? line.column : 0;
      if (!byColumn.has(key)) byColumn.set(key, []);
      byColumn.get(key).push(line);
    }

    const entries = [];
    for (const col of [...byColumn.keys()].sort((a, b) => a - b)) {
      let current = [];
      for (const line of byColumn.get(col)) {
        const startsNew = /^((\[\d+\])|(\d+\.)|([A-Z][^\n]+\(\d{4}[a-z]?\)))/.test(line.text);
        if (startsNew && current.length) {
          entries.push(mergeLines(current));
          current = [];
        }
        current.push(line);
      }
      if (current.length) entries.push(mergeLines(current));
    }

    return entries.filter(Boolean).map((entry) => `- ${entry}`).join("\n");
  }
  function orderPageLines(page) {
    if (page.columns.count > 1) {
      const standalone = [];
      const byColumn = Array.from({ length: page.columns.count }, () => []);

      for (const line of page.lines) {
        if (line.column === -1 || page.columns.count === 1) {
          standalone.push(line);
        } else {
          byColumn[line.column].push(line);
        }
      }

      standalone.sort((a, b) => b.y - a.y);
      byColumn.forEach((group) => group.sort((a, b) => b.y - a.y));

      const highestColumnTop = byColumn.length
        ? Math.max(...byColumn.map((g) => (g[0] ? g[0].y : -Infinity)))
        : -Infinity;
      const lowestColumnBottom = byColumn.length
        ? Math.min(...byColumn.map((g) => (g[g.length - 1] ? g[g.length - 1].y : Infinity)))
        : Infinity;

      const top = standalone.filter((line) => line.y > highestColumnTop);
      const mid = standalone.filter((line) => line.y <= highestColumnTop && line.y >= lowestColumnBottom);
      const bottom = standalone.filter((line) => line.y < lowestColumnBottom);

      return [...top, ...byColumn.flatMap((g) => g), ...mid, ...bottom];
    }

    const prepared = page.lines.map((line) => ({ ...line, pageWidth: page.pageWidth }));
    const bands = clusterByVerticalBands(prepared);
    const ordered = [];
    for (const band of bands) {
      ordered.push(...orderBandLines(band.lines, 1));
    }
    return ordered;
  }

  function assembleMarkdown(pages) {
    const out = [];
    let paragraphBuffer = [];
    let inReferences = false;
    let referenceBuffer = [];

    const flushParagraph = () => {
      const paragraph = mergeLines(paragraphBuffer);
      if (paragraph) out.push(paragraph);
      paragraphBuffer = [];
    };
    const flushReferences = () => {
      if (!referenceBuffer.length) return;
      out.push(assembleReferences(referenceBuffer));
      referenceBuffer = [];
    };

    for (const page of pages) {
      const ordered = orderPageLines(page);
      for (let i = 0; i < ordered.length; i += 1) {
        const line = ordered[i];
        const next = ordered[i + 1] || null;
        if (["furniture", "page_number", "license", "sidebar"].includes(line.region)) {
          continue;
        }
        if (line.region === "references_heading") {
          flushParagraph();
          flushReferences();
          out.push("## References");
          inReferences = true;
          continue;
        }

        if (inReferences) {
          if (line.region === "heading") {
            flushReferences();
            inReferences = false;
          } else {
            referenceBuffer.push(line);
            continue;
          }
        }

        if (line.region === "heading" || line.region.endsWith("_heading")) {
          flushParagraph();
          const clean = line.text.replace(/:$/, "").trim();
          out.push(`## ${clean}`);
          continue;
        }

        paragraphBuffer.push(line);
        if (shouldBreakParagraph(line, next)) {
          flushParagraph();
        }
      }
      flushParagraph();
    }

    flushParagraph();
    flushReferences();
    return out.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }


  function analyzeDocumentProfile(rawPages) {
    const pages = rawPages || [];
    const profile = {
      pageCount: pages.length,
      sampledPages: 0,
      textItemCount: 0,
      wordCount: 0,
      alphabeticCount: 0,
      symbolCount: 0,
      longWordCount: 0,
      glyphlessItemRatio: 0,
      avgTextLenPerItem: 0,
      classification: "digital-native",
      confidence: "medium",
      reasons: [],
    };

    if (!pages.length) {
      profile.classification = "unknown";
      profile.confidence = "low";
      profile.reasons.push("no_pages");
      return profile;
    }

    let glyphlessHits = 0;
    let sampledItems = 0;
    let textLenTotal = 0;

    for (const page of pages) {
      profile.sampledPages += 1;
      for (const item of page.items || []) {
        const str = normalizeText(item.str || "");
        if (!str) continue;
        profile.textItemCount += 1;
        sampledItems += 1;
        textLenTotal += str.length;

        const font = (item.fontName || "").toLowerCase();
        if (font.includes("glyphless") || font.includes("fallback") || font.includes("unknown")) {
          glyphlessHits += 1;
        }

        const words = str.split(/\s+/).filter(Boolean);
        profile.wordCount += words.length;
        for (const w of words) {
          if (/[\p{L}]/u.test(w)) profile.alphabeticCount += 1;
          if (/^[^\p{L}\p{N}]+$/u.test(w)) profile.symbolCount += 1;
          if (w.length >= 18) profile.longWordCount += 1;
        }
      }
    }

    profile.glyphlessItemRatio = sampledItems ? glyphlessHits / sampledItems : 0;
    profile.avgTextLenPerItem = sampledItems ? textLenTotal / sampledItems : 0;

    const symbolRatio = profile.wordCount ? profile.symbolCount / profile.wordCount : 0;
    const longWordRatio = profile.wordCount ? profile.longWordCount / profile.wordCount : 0;

    if (profile.glyphlessItemRatio > 0.25) profile.reasons.push("glyphless_font_layer");
    if (symbolRatio > 0.14) profile.reasons.push("high_symbol_ratio");
    if (longWordRatio > 0.12) profile.reasons.push("high_long_token_ratio");
    if (profile.avgTextLenPerItem < 5) profile.reasons.push("short_text_spans");

    const ocrScore =
      (profile.glyphlessItemRatio > 0.25 ? 2 : 0) +
      (symbolRatio > 0.14 ? 1 : 0) +
      (longWordRatio > 0.12 ? 1 : 0) +
      (profile.avgTextLenPerItem < 5 ? 1 : 0);

    if (ocrScore >= 2) {
      profile.classification = "ocr-overlay";
      profile.confidence = ocrScore >= 3 ? "high" : "medium";
    }

    return profile;
  }

  function convertPdfItemsToMarkdown(rawPages) {
    const profile = analyzeDocumentProfile(rawPages);
    const analyzed = rawPages.map((page, i) =>
      analyzePage(page.items, page.width, page.height, i + 1),
    ).map((page) => {
      if (profile.classification !== "ocr-overlay") return page;
      const lines = page.lines.map((line) => {
        if (line.region === "sidebar" || line.region === "metadata") {
          return { ...line, region: "furniture" };
        }
        if (line.region === "heading" && line.text.length < 4) {
          return { ...line, region: "body" };
        }
        return line;
      });
      return { ...page, lines };
    });
    const cleaned = suppressRepeatedFurniture(analyzed);
    return assembleMarkdown(cleaned);
  }

  function extractPageText(page) {
    const ordered = orderPageLines(page);
    const headings = [];
    const paragraphs = [];
    let paragraphBuffer = [];

    const flushParagraph = () => {
      const text = mergeLines(paragraphBuffer);
      if (text) paragraphs.push(text);
      paragraphBuffer = [];
    };

    for (let i = 0; i < ordered.length; i += 1) {
      const line = ordered[i];
      const next = i + 1 < ordered.length ? ordered[i + 1] : null;

      if (["furniture", "page_number", "license", "sidebar"].includes(line.region)) {
        continue;
      }

      if (line.region === "heading" || line.region.endsWith("_heading")) {
        flushParagraph();
        const clean = line.text.replace(/:$/, "").trim();
        headings.push(clean);
        paragraphs.push(clean);
        continue;
      }

      paragraphBuffer.push(line);
      if (shouldBreakParagraph(line, next)) {
        flushParagraph();
      }
    }
    flushParagraph();

    const text = paragraphs.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, headings };
  }

  function extractStructuredPages(rawPages) {
    const profile = analyzeDocumentProfile(rawPages);
    const analyzed = rawPages.map((page, i) =>
      analyzePage(page.items, page.width, page.height, i + 1),
    ).map((page) => {
      if (profile.classification !== "ocr-overlay") return page;
      return {
        ...page,
        lines: page.lines.map((line) => {
          if (line.region === "sidebar" || line.region === "metadata") {
            return { ...line, region: "furniture" };
          }
          return line;
        }),
      };
    });
    const cleaned = suppressRepeatedFurniture(analyzed);
    return cleaned.map((page, i) => {
      const { text, headings } = extractPageText(page);
      return {
        page: i + 1,
        text,
        headings,
        char_count: text.length,
      };
    });
  }

  const api = {
    analyzePage,
    convertPdfItemsToMarkdown,
    extractStructuredPages,
    suppressRepeatedFurniture,
    orderPageLines,
    assembleMarkdown,
    classifyLine,
    analyzeDocumentProfile,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.PdfPipeline = api;
})(typeof window !== "undefined" ? window : globalThis);
