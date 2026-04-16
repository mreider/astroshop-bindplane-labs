#!/usr/bin/env node
/**
 * Build editable PPTX from Marp markdown
 *
 * Matches the Dynatrace Marp theme: dark background, gradient headers, cyan highlights
 *
 * Usage: node build-pptx.cjs [input.md] [output.pptx]
 * Default: examples/getting-started.md -> exports/getting-started.pptx
 */

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

// Theme colors (matching bp.mreider.com primer CSS)
const THEME = {
  bgDark: '0B0F1A',
  textWhite: 'FFFFFF',
  accentCyan: '1496FF',
  accentPurple: '6366F1',
  codeBg: '141827',
  tableBorder: '1E2535',
  tableHeaderBg: '141827',
  placeholderBg: '141827',
  placeholderBorder: '1496FF',
};

// Parse command line args
const args = process.argv.slice(2);
const inputFile = args[0] || 'examples/getting-started.md';
const outputFile = args[1] || 'exports/getting-started.pptx';

// Read the Marp markdown
const mdPath = path.resolve(__dirname, inputFile);
if (!fs.existsSync(mdPath)) {
  console.error(`Error: File not found: ${mdPath}`);
  process.exit(1);
}
const mdContent = fs.readFileSync(mdPath, 'utf8');

// Split into slides
function parseSlides(content) {
  // Remove frontmatter (everything between first --- and second ---)
  const noFrontmatter = content.replace(/^---[\s\S]*?---\n/m, '');

  // Split by slide separators
  const rawSlides = noFrontmatter.split(/\n---\n/);

  return rawSlides.map(slideContent => {
    const slide = {
      isTitle: false,
      isScreenshot: false,
      isDiagram: false,
      title: '',
      elements: [],
    };

    if (slideContent.includes('_class: title')) slide.isTitle = true;
    if (slideContent.includes('_class: screenshot')) slide.isScreenshot = true;
    if (slideContent.includes('_class: diagram')) slide.isDiagram = true;

    // Remove HTML comments
    const cleaned = slideContent.replace(/<!--[\s\S]*?-->/g, '').trim();
    const lines = cleaned.split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim() || line.trim().startsWith('_class:')) { i++; continue; }

      // Title (# header) - only H1, not ## or ###
      if (line.match(/^# [^#]/)) {
        slide.title = line.replace(/^# /, '').trim();
        i++;
        continue;
      }

      // Subheading (## or ###) - render as styled text element
      if (line.match(/^#{2,} /)) {
        slide.elements.push({ type: 'subheading', content: line.replace(/^#{2,} /, '').trim() });
        i++;
        continue;
      }

      // Image/placeholder
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imgMatch) {
        slide.elements.push({ type: 'placeholder', alt: imgMatch[1], src: imgMatch[2] });
        i++;
        continue;
      }

      // Code block
      if (line.startsWith('```')) {
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        slide.elements.push({ type: 'code', content: codeLines.join('\n') });
        continue;
      }

      // Table
      if (line.startsWith('|')) {
        const tableRows = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          const row = lines[i];
          if (!row.match(/^\|[\s\-:|]+$/)) {
            const cells = row.split('|').slice(1, -1).map(c => c.trim());
            tableRows.push(cells);
          }
          i++;
        }
        if (tableRows.length > 0) {
          slide.elements.push({ type: 'table', content: tableRows });
        }
        continue;
      }

      // Bullet list
      if (line.startsWith('- ') || line.match(/^\d+\. /)) {
        const bullets = [];
        while (i < lines.length && (lines[i].startsWith('- ') || lines[i].match(/^\d+\. /))) {
          bullets.push(lines[i].replace(/^[-\d.]+\s*/, ''));
          i++;
        }
        slide.elements.push({ type: 'bullets', content: bullets });
        continue;
      }

      // Regular paragraph
      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() &&
             !lines[i].startsWith('# ') &&
             !lines[i].startsWith('```') &&
             !lines[i].startsWith('|') &&
             !lines[i].startsWith('- ') &&
             !lines[i].match(/^\d+\. /)) {
        paragraphLines.push(lines[i].trim());
        i++;
      }
      if (paragraphLines.length > 0) {
        slide.elements.push({ type: 'paragraph', content: paragraphLines.join(' ') });
      }
    }

    return slide;
  }).filter(s => s.title || s.elements.length > 0 || s.isTitle);
}

// Convert **bold** and `code` to pptxgenjs text array
function formatText(text, baseFontSize = 20) {
  const parts = [];
  const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        options: { color: THEME.textWhite, fontSize: baseFontSize, fontFace: 'Inter' }
      });
    }

    if (match[2]) {
      parts.push({
        text: match[2],
        options: { color: THEME.accentCyan, bold: true, fontSize: baseFontSize, fontFace: 'Inter' }
      });
    } else if (match[4]) {
      parts.push({
        text: match[4],
        options: { color: THEME.textWhite, fontSize: baseFontSize - 2, fontFace: 'JetBrains Mono' }
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      options: { color: THEME.textWhite, fontSize: baseFontSize, fontFace: 'Inter' }
    });
  }

  return parts.length > 0 ? parts : [{
    text,
    options: { color: THEME.textWhite, fontSize: baseFontSize, fontFace: 'Inter' }
  }];
}

// Build the presentation
const pptx = new PptxGenJS();
pptx.author = 'Dynatrace';
pptx.title = path.basename(inputFile, '.md');
pptx.layout = 'LAYOUT_16x9';

pptx.defineSlideMaster({
  title: 'DARK_MASTER',
  background: { color: THEME.bgDark },
});

const slides = parseSlides(mdContent);

// Check if input file has watermark class
const hasWatermark = /class:.*\bwatermark\b/.test(mdContent);

for (const slideData of slides) {
  const slide = pptx.addSlide({ masterName: 'DARK_MASTER' });

  // Add watermark if enabled
  if (hasWatermark) {
    slide.addText('INTERNAL DRAFT - DO NOT SHARE', {
      x: 0.3, y: 5.1, w: 9.4, h: 0.35,
      fontSize: 14, fontFace: 'Inter', color: 'CCCC00',
      align: 'center', bold: true, transparency: 30,
    });
  }

  if (slideData.isTitle) {
    const titleText = slideData.title || 'Untitled';
    // Scale font and layout for long titles
    const titleLen = titleText.length;
    const titleFontSize = titleLen > 50 ? 32 : titleLen > 35 ? 36 : 40;
    const titleH = titleLen > 50 ? 1.4 : titleLen > 35 ? 1.2 : 1;
    const titleY = titleLen > 50 ? 1.8 : titleLen > 35 ? 2.0 : 2.2;
    const barY = titleY + titleH + 0.1;

    slide.addText(titleText, {
      x: 0.5, y: titleY, w: 9, h: titleH,
      fontSize: titleFontSize, fontFace: 'Inter', color: THEME.textWhite,
      align: 'center', bold: true,
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: 2, y: barY, w: 6, h: 0.06,
      fill: { color: THEME.accentCyan },
    });

    if (slideData.elements.length > 0 && slideData.elements[0].type === 'paragraph') {
      slide.addText(formatText(slideData.elements[0].content), {
        x: 0.5, y: barY + 0.3, w: 9, h: 0.6, align: 'center',
      });
    }
    continue;
  }

  // Screenshot placeholder slide
  if (slideData.isScreenshot) {
    let yPos = 0.3;

    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5, y: yPos, w: 9, h: 0.6,
        fontSize: 28, fontFace: 'Inter', color: THEME.textWhite, bold: true,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: yPos + 0.65, w: 9, h: 0.04, fill: { color: THEME.accentCyan },
      });
      yPos = 1.1;
    }

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: yPos, w: 9, h: 3.4,
      fill: { color: THEME.placeholderBg },
      line: { color: THEME.placeholderBorder, pt: 2, dashType: 'dash' },
    });

    slide.addText('[ INSERT SCREENSHOT HERE ]', {
      x: 0.5, y: yPos + 1.4, w: 9, h: 0.6,
      fontSize: 20, fontFace: 'Inter', color: THEME.accentCyan,
      align: 'center', bold: true,
    });

    yPos += 3.6;
    const maxYNotes = 5.4;

    slide.addText('AUTHOR NOTES (delete before presenting):', {
      x: 0.5, y: yPos, w: 9, h: 0.25,
      fontSize: 9, fontFace: 'Inter', color: 'FF6B6B', bold: true,
    });
    yPos += 0.28;

    for (const element of slideData.elements) {
      if (yPos > maxYNotes) break;
      if (element.type === 'placeholder') continue;

      if (element.type === 'paragraph') {
        const height = Math.min(Math.max(0.18, Math.ceil(element.content.length / 120) * 0.16), maxYNotes - yPos);
        slide.addText(formatText(element.content, 9), {
          x: 0.5, y: yPos, w: 9, h: height,
          fontSize: 9, valign: 'top', wrap: true, color: 'AAAAAA',
        });
        yPos += height + 0.06;
      } else if (element.type === 'bullets') {
        const bulletText = element.content.map(item => ({
          text: item.replace(/\*\*/g, '').replace(/`/g, ''),
          options: { bullet: { code: '2022', color: '666666' }, color: 'AAAAAA' }
        }));
        const height = Math.min(element.content.length * 0.18, maxYNotes - yPos);
        slide.addText(bulletText, {
          x: 0.5, y: yPos, w: 9, h: height,
          fontSize: 9, fontFace: 'Inter', valign: 'top',
        });
        yPos += height + 0.06;
      }
    }
    continue;
  }

  // Diagram placeholder slide
  if (slideData.isDiagram) {
    let yPos = 0.3;

    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5, y: yPos, w: 9, h: 0.6,
        fontSize: 28, fontFace: 'Inter', color: THEME.textWhite, bold: true,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: yPos + 0.65, w: 9, h: 0.04, fill: { color: THEME.accentPurple },
      });
      yPos = 1.1;
    }

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: yPos, w: 9, h: 3.4,
      fill: { color: THEME.placeholderBg },
      line: { color: THEME.accentPurple, pt: 2, dashType: 'dash' },
    });

    slide.addText('[ CREATE DIAGRAM ]', {
      x: 0.5, y: yPos + 1.4, w: 9, h: 0.6,
      fontSize: 20, fontFace: 'Inter', color: THEME.accentPurple,
      align: 'center', bold: true,
    });
    continue;
  }

  // Regular slide
  let yPos = 0.5;
  const maxY = 5.2;

  // Calculate content density for font scaling
  let totalBullets = 0, totalParagraphs = 0, totalTableRows = 0, totalSubheadings = 0;
  for (const el of slideData.elements) {
    if (el.type === 'bullets') totalBullets += el.content.length;
    if (el.type === 'paragraph') totalParagraphs++;
    if (el.type === 'table') totalTableRows += el.content.length;
    if (el.type === 'subheading') totalSubheadings++;
  }

  const contentScore = totalBullets * 0.5 + totalParagraphs * 0.3 + totalTableRows * 0.35 + totalSubheadings * 0.4;
  const fontScale = contentScore > 6 ? 0.75 : contentScore > 4 ? 0.85 : 1.0;

  const titleSize = Math.round(36 * fontScale);
  const bodySize = Math.round(20 * fontScale);
  const bulletSize = Math.round(22 * fontScale);
  const tableSize = Math.round(12 * fontScale);

  if (slideData.title) {
    // Estimate title lines: ~40 chars per line at default size, fewer when scaled
    const charsPerTitleLine = Math.round(40 / fontScale);
    const titleLines = Math.ceil(slideData.title.length / charsPerTitleLine);
    const titleHeight = Math.max(0.7, titleLines * 0.5);
    const barY = yPos + titleHeight + 0.1;

    slide.addText(slideData.title, {
      x: 0.5, y: yPos, w: 9, h: titleHeight,
      fontSize: titleSize, fontFace: 'Inter', color: THEME.textWhite, bold: true,
    });

    // Gradient bar - cyan left, purple right
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: barY, w: 4.5, h: 0.06,
      fill: { color: THEME.accentCyan }, line: { color: THEME.accentCyan, pt: 0 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 5.0, y: barY, w: 4.5, h: 0.06,
      fill: { color: THEME.accentPurple }, line: { color: THEME.accentPurple, pt: 0 },
    });

    yPos = barY + 0.3;
  }

  for (const element of slideData.elements) {
    if (yPos > maxY) break;

    if (element.type === 'subheading') {
      const subSize = Math.round(26 * fontScale);
      slide.addText(element.content, {
        x: 0.5, y: yPos, w: 9, h: 0.5,
        fontSize: subSize, fontFace: 'Inter', color: THEME.accentCyan,
        bold: true, valign: 'top',
      });
      yPos += 0.55;
    }

    else if (element.type === 'paragraph') {
      const charsPerLine = Math.round(55 / fontScale);
      const estLines = Math.ceil(element.content.length / charsPerLine);
      const height = Math.min(Math.max(0.4, estLines * 0.32 * fontScale), maxY - yPos);

      slide.addText(formatText(element.content, bodySize), {
        x: 0.5, y: yPos, w: 9, h: height, fontSize: bodySize, valign: 'top', wrap: true,
      });
      yPos += height + 0.2;
    }

    else if (element.type === 'bullets') {
      const bulletText = element.content.map(item => ({
        text: item.replace(/\*\*/g, '').replace(/`/g, ''),
        options: { bullet: { code: '2022', color: THEME.textWhite }, color: THEME.textWhite }
      }));
      const height = Math.min(element.content.length * 0.45 * fontScale, maxY - yPos);

      slide.addText(bulletText, {
        x: 0.5, y: yPos, w: 9, h: height,
        fontSize: bulletSize, fontFace: 'Inter', color: THEME.textWhite,
        valign: 'top', lineSpacingMultiple: 1.2,
      });
      yPos += height + 0.15;
    }

    else if (element.type === 'code') {
      if (!element.content || element.content.trim() === '') continue;
      const codeLines = element.content.split('\n').length;
      const desiredHeight = codeLines * 0.25 + 0.2;
      const availableHeight = maxY - yPos;
      if (availableHeight < 0.5) continue; // skip if no room
      const height = Math.min(desiredHeight, availableHeight, 3.0);

      slide.addText(element.content, {
        x: 0.5, y: yPos, w: 9, h: Math.max(height, 0.5),
        fontSize: 11, fontFace: 'JetBrains Mono', color: THEME.textWhite,
        fill: { color: THEME.codeBg }, valign: 'top',
      });
      yPos += height + 0.15;
    }

    else if (element.type === 'table') {
      const tableData = element.content.map((row, rowIdx) =>
        row.map(cell => ({
          text: cell.replace(/\*\*/g, '').replace(/`/g, ''),
          options: {
            fill: THEME.bgDark,
            color: THEME.textWhite,
            fontSize: tableSize,
            fontFace: 'Inter',
            bold: rowIdx === 0,
            border: [
              { pt: 0, color: THEME.bgDark },
              { pt: 0, color: THEME.bgDark },
              { pt: rowIdx === 0 ? 1 : 0.5, color: THEME.tableBorder },
              { pt: 0, color: THEME.bgDark },
            ],
            valign: 'middle',
          }
        }))
      );

      const numCols = element.content[0]?.length || 2;
      const colWidths = Array(numCols).fill(9 / numCols);
      const rowHeight = 0.32 * fontScale;

      slide.addTable(tableData, {
        x: 0.5, y: yPos, w: 9, colW: colWidths, rowH: rowHeight,
      });
      yPos += element.content.length * rowHeight + 0.15;
    }

    else if (element.type === 'placeholder') {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: yPos, w: 9, h: 2,
        fill: { color: THEME.placeholderBg },
        line: { color: THEME.placeholderBorder, pt: 1, dashType: 'dash' },
      });
      slide.addText('[ IMAGE ]', {
        x: 0.5, y: yPos + 0.7, w: 9, h: 0.5,
        fontSize: 16, fontFace: 'Inter', color: THEME.accentCyan, align: 'center',
      });
      yPos += 2.2;
    }
  }
}

// Save
const outputPath = path.resolve(__dirname, outputFile);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

pptx.writeFile({ fileName: outputPath })
  .then(() => {
    console.log(`Created: ${outputPath}`);
    console.log(`Slides: ${slides.length}`);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
