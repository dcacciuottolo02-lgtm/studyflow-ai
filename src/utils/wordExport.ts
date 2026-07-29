'use strict'

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx'
import { saveAs } from 'file-saver'

interface ExportWordOptions {
  title: string
  courseName: string
  date: string
  content: string
  type: 'notes' | 'summary'
}

/**
 * Generates and downloads a beautifully styled Microsoft Word (.docx) document
 * for Student Personal Notes or AI Lecture Summaries.
 */
export async function exportToWord({
  title,
  courseName,
  date,
  content,
  type,
}: ExportWordOptions): Promise<void> {
  const docTitle = type === 'notes' ? `Note: ${title}` : `Riassunto: ${title}`
  const docBadge = type === 'notes' ? '📝 NOTE PERSONALI DELLO STUDENTE' : '🤖 RIASSUNTO AI DELLA LEZIONE'

  // Parse lines of content into formatted paragraphs
  const contentParagraphs: Paragraph[] = []
  const rawLines = content.split('\n')

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) {
      contentParagraphs.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    // Heading 1 (# Heading)
    if (line.startsWith('# ')) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace('# ', ''),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      )
    }
    // Heading 2 (## Heading)
    else if (line.startsWith('## ')) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace('## ', ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 220, after: 100 },
        })
      )
    }
    // Heading 3 (### Heading)
    else if (line.startsWith('### ')) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace('### ', ''),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 180, after: 80 },
        })
      )
    }
    // Bullet points (- or *)
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      const bulletText = line.substring(2)
      const runs = parseInlineFormatting(bulletText)
      contentParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: '•  ', bold: true, color: '4F46E5' }), ...runs],
          indent: { left: 360 },
          spacing: { after: 80 },
        })
      )
    }
    // Timestamp callout [MM:SS] or ⏱️ [MM:SS]
    else if (line.includes('[') && line.includes(']') && (line.includes('⏱️') || /\[\d{1,2}:\d{2}\]/.test(line))) {
      contentParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              bold: true,
              color: '4338CA',
            }),
          ],
          shading: {
            type: ShadingType.CLEAR,
            fill: 'EEF2FF',
          },
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: '6366F1' },
          },
          indent: { left: 180 },
          spacing: { before: 140, after: 140 },
        })
      )
    }
    // Standard paragraph
    else {
      const runs = parseInlineFormatting(line)
      contentParagraphs.push(
        new Paragraph({
          children: runs,
          spacing: { after: 100, line: 276 }, // 1.15 line spacing
        })
      )
    }
  }

  // Create Header metadata box (Table)
  const headerMetaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
              left: { style: BorderStyle.SINGLE, size: 24, color: '4F46E5' },
              right: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
            },
            margins: { top: 180, bottom: 180, left: 240, right: 240 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: docBadge,
                    bold: true,
                    size: 18,
                    color: '4F46E5',
                  }),
                ],
                spacing: { after: 60 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: 'Corso: ', bold: true, size: 20, color: '64748B' }),
                  new TextRun({ text: courseName, bold: true, size: 20, color: '1E293B' }),
                  new TextRun({ text: '   |   Data: ', bold: true, size: 20, color: '64748B' }),
                  new TextRun({ text: date, bold: true, size: 20, color: '1E293B' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })

  // Build complete Word Document
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 22, // 11pt
            color: '334155',
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Calibri',
            size: 34, // 17pt
            bold: true,
            color: '1E1B4B',
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Calibri',
            size: 28, // 14pt
            bold: true,
            color: '312E81',
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Calibri',
            size: 24, // 12pt
            bold: true,
            color: '4338CA',
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'StudentFlow AI  •  Pagina ',
                    size: 18,
                    color: '94A3B8',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    color: '94A3B8',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Title Banner
          new Paragraph({
            text: docTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 180 },
          }),
          headerMetaTable,
          new Paragraph({ spacing: { after: 240 } }),
          ...contentParagraphs,
        ],
      },
    ],
  })

  // Generate buffer and trigger browser saveAs download
  const blob = await Packer.toBlob(doc)
  const cleanFilename = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '')}_${type === 'notes' ? 'Note' : 'Riassunto'}.docx`
  saveAs(blob, cleanFilename)
}

/**
 * Parses markdown bold (**text**) and italic (*text*) into docx TextRuns
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  // Split by bold (**text**)
  const parts = text.split(/(\*\*.*?\*\*)/g)

  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          color: '0F172A',
        })
      )
    } else {
      runs.push(
        new TextRun({
          text: part,
          color: '334155',
        })
      )
    }
  }

  return runs
}
