use std::fs;

use printpdf::{BuiltinFont, Mm, Op, PdfDocument, PdfPage, PdfSaveOptions, Point, Pt, TextItem};
use serde::Deserialize;

const PAGE_WIDTH_MM: f32 = 210.0;
const PAGE_HEIGHT_MM: f32 = 297.0;
const MARGIN_MM: f32 = 19.05;
const BODY_FONT_SIZE: f32 = 11.5;
const TITLE_FONT_SIZE: f32 = 22.0;
const HEADING_FONT_SIZE: f32 = 14.0;
const ANNOTATION_FONT_SIZE: f32 = 10.5;
const BODY_LINE_HEIGHT: f32 = 15.0;
const TITLE_LINE_HEIGHT: f32 = 28.0;
const HEADING_LINE_HEIGHT: f32 = 18.0;
const ANNOTATION_LINE_HEIGHT: f32 = 13.0;
const BODY_PARAGRAPH_GAP: f32 = 8.0;
const SECTION_GAP: f32 = 14.0;
const ANNOTATION_GAP: f32 = 10.0;
const CHARACTER_WIDTH_FACTOR: f32 = 0.52;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportPayload {
    pub title: String,
    pub body_paragraphs: Vec<String>,
    pub annotations: Vec<String>,
}

#[derive(Clone, Copy)]
enum TextStyle {
    Title,
    Heading,
    Body,
    Annotation,
}

impl TextStyle {
    fn font(self) -> BuiltinFont {
        match self {
            Self::Title | Self::Heading => BuiltinFont::HelveticaBold,
            Self::Body => BuiltinFont::TimesRoman,
            Self::Annotation => BuiltinFont::Helvetica,
        }
    }

    fn font_size(self) -> f32 {
        match self {
            Self::Title => TITLE_FONT_SIZE,
            Self::Heading => HEADING_FONT_SIZE,
            Self::Body => BODY_FONT_SIZE,
            Self::Annotation => ANNOTATION_FONT_SIZE,
        }
    }

    fn line_height(self) -> f32 {
        match self {
            Self::Title => TITLE_LINE_HEIGHT,
            Self::Heading => HEADING_LINE_HEIGHT,
            Self::Body => BODY_LINE_HEIGHT,
            Self::Annotation => ANNOTATION_LINE_HEIGHT,
        }
    }
}

struct FlowLine {
    text: String,
    style: TextStyle,
    gap_after: f32,
}

pub fn export_pdf_to_path(path: &str, payload: &PdfExportPayload) -> Result<(), String> {
    let bytes = render_pdf_bytes(payload);
    fs::write(path, bytes).map_err(|err| err.to_string())
}

fn render_pdf_bytes(payload: &PdfExportPayload) -> Vec<u8> {
    let mut warnings = Vec::new();
    render_pdf_document(payload).save(&PdfSaveOptions::default(), &mut warnings)
}

fn render_pdf_document(payload: &PdfExportPayload) -> PdfDocument {
    let mut document = PdfDocument::new(&payload.title);
    let flow = build_flow_lines(payload);
    let pages = paginate_lines(&flow);

    for page_lines in pages {
        let mut ops = Vec::with_capacity(page_lines.len() * 5);

        for placed in page_lines {
            let font = placed.style.font();
            ops.push(Op::StartTextSection);
            ops.push(Op::SetTextCursor {
                pos: point_from_pt(mm_to_pt(MARGIN_MM), placed.baseline_y_pt),
            });
            ops.push(Op::SetFontSizeBuiltinFont {
                size: Pt(placed.style.font_size()),
                font,
            });
            ops.push(Op::WriteTextBuiltinFont {
                items: vec![TextItem::Text(placed.text)],
                font,
            });
            ops.push(Op::EndTextSection);
        }

        document
            .pages
            .push(PdfPage::new(Mm(PAGE_WIDTH_MM), Mm(PAGE_HEIGHT_MM), ops));
    }

    document
}

fn build_flow_lines(payload: &PdfExportPayload) -> Vec<FlowLine> {
    let mut flow = Vec::new();

    push_wrapped_block(&mut flow, &payload.title, TextStyle::Title, SECTION_GAP);

    if payload.body_paragraphs.is_empty() {
        flow.push(FlowLine {
            text: String::new(),
            style: TextStyle::Body,
            gap_after: BODY_PARAGRAPH_GAP,
        });
    } else {
        for paragraph in &payload.body_paragraphs {
            push_wrapped_block(&mut flow, paragraph, TextStyle::Body, BODY_PARAGRAPH_GAP);
        }
    }

    if !payload.annotations.is_empty() {
        push_wrapped_block(
            &mut flow,
            "Annotations",
            TextStyle::Heading,
            BODY_PARAGRAPH_GAP,
        );

        for annotation in &payload.annotations {
            push_wrapped_block(&mut flow, annotation, TextStyle::Annotation, ANNOTATION_GAP);
        }
    }

    if let Some(last) = flow.last_mut() {
        last.gap_after = 0.0;
    }

    flow
}

fn push_wrapped_block(flow: &mut Vec<FlowLine>, text: &str, style: TextStyle, gap_after: f32) {
    let max_chars = max_chars_per_line(style);
    let mut block_lines = wrap_block(text, max_chars);
    if block_lines.is_empty() {
        block_lines.push(String::new());
    }

    let last_index = block_lines.len().saturating_sub(1);
    for (index, line) in block_lines.into_iter().enumerate() {
        flow.push(FlowLine {
            text: line,
            style,
            gap_after: if index == last_index { gap_after } else { 0.0 },
        });
    }
}

fn wrap_block(text: &str, max_chars: usize) -> Vec<String> {
    let mut wrapped = Vec::new();

    for raw_line in text.lines() {
        if raw_line.trim().is_empty() {
            wrapped.push(String::new());
            continue;
        }

        wrapped.extend(wrap_line(raw_line, max_chars));
    }

    wrapped
}

fn wrap_line(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        if word.chars().count() > max_chars {
            if !current.is_empty() {
                lines.push(current);
                current = String::new();
            }
            lines.extend(chunk_long_word(word, max_chars));
            continue;
        }

        let candidate_len = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };

        if candidate_len > max_chars && !current.is_empty() {
            lines.push(current);
            current = word.to_string();
        } else if current.is_empty() {
            current = word.to_string();
        } else {
            current.push(' ');
            current.push_str(word);
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

fn chunk_long_word(word: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for ch in word.chars() {
        current.push(ch);
        if current.chars().count() >= max_chars {
            chunks.push(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

fn max_chars_per_line(style: TextStyle) -> usize {
    let usable_width_pt = mm_to_pt(PAGE_WIDTH_MM - (MARGIN_MM * 2.0));
    let approx_char_width_pt = style.font_size() * CHARACTER_WIDTH_FACTOR;
    (usable_width_pt / approx_char_width_pt).floor() as usize
}

struct PlacedLine {
    text: String,
    style: TextStyle,
    baseline_y_pt: f32,
}

fn paginate_lines(flow: &[FlowLine]) -> Vec<Vec<PlacedLine>> {
    let mut pages = vec![Vec::new()];
    let top_y_pt = mm_to_pt(PAGE_HEIGHT_MM - MARGIN_MM);
    let bottom_margin_pt = mm_to_pt(MARGIN_MM);
    let mut current_y_pt = top_y_pt;

    for line in flow {
        let line_height = line.style.line_height();
        if current_y_pt - line_height < bottom_margin_pt {
            pages.push(Vec::new());
            current_y_pt = top_y_pt;
        }

        let baseline_y_pt = current_y_pt;
        pages
            .last_mut()
            .expect("at least one page")
            .push(PlacedLine {
                text: line.text.clone(),
                style: line.style,
                baseline_y_pt,
            });

        current_y_pt -= line_height + line.gap_after;
    }

    pages
}

fn point_from_pt(x_pt: f32, y_pt: f32) -> Point {
    Point::new(Mm(pt_to_mm(x_pt)), Mm(pt_to_mm(y_pt)))
}

fn mm_to_pt(mm: f32) -> f32 {
    mm * 72.0 / 25.4
}

fn pt_to_mm(pt: f32) -> f32 {
    pt * 25.4 / 72.0
}

#[cfg(test)]
mod tests {
    use printpdf::{Op, PdfDocument, PdfParseOptions};

    use super::{build_flow_lines, paginate_lines, render_pdf_bytes, PdfExportPayload};

    fn sample_payload() -> PdfExportPayload {
        PdfExportPayload {
            title: "Test Document".to_string(),
            body_paragraphs: vec!["Hello world".to_string()],
            annotations: vec!["1. Comment (0-5)\nOn: \"Hello\"\nAlice: Nice greeting!".to_string()],
        }
    }

    #[test]
    fn renders_valid_pdf_bytes() {
        let bytes = render_pdf_bytes(&sample_payload());
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 500);
    }

    #[test]
    fn resets_text_section_for_each_rendered_line() {
        let bytes = render_pdf_bytes(&sample_payload());
        let parsed =
            PdfDocument::parse(&bytes, &PdfParseOptions::default(), &mut Vec::new()).unwrap();
        let ops = &parsed.pages[0].ops;
        let flow_line_count = build_flow_lines(&sample_payload()).len();

        let text_section_starts = ops
            .iter()
            .filter(|op| matches!(op, Op::StartTextSection))
            .count();

        assert_eq!(text_section_starts, flow_line_count);
    }

    #[test]
    fn paginates_large_exports() {
        let flow = build_flow_lines(&PdfExportPayload {
            title: "Long Document".to_string(),
            body_paragraphs: vec!["word ".repeat(6000)],
            annotations: Vec::new(),
        });

        let pages = paginate_lines(&flow);
        assert!(pages.len() > 1);
    }
}
