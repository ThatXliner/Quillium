use std::{collections::BTreeMap, fs};
use textwrap::wrap;

use printpdf::{
    BuiltinFont, Color, LinePoint, Mm, Op, PaintMode, PdfDocument, PdfPage, PdfSaveOptions, Point,
    Polygon, PolygonRing, Pt, Rgb, TextItem, WindingOrder,
};
use serde::Deserialize;

const PAGE_WIDTH_MM: f32 = 210.0;
const PAGE_HEIGHT_MM: f32 = 297.0;
const MARGIN_MM: f32 = 19.05;
const TITLE_FONT_SIZE: f32 = 22.0;
const HEADING_FONT_SIZE: f32 = 14.0;
const BODY_FONT_SIZE: f32 = 11.5;
const CARD_TITLE_FONT_SIZE: f32 = 11.5;
const CARD_SUBTITLE_FONT_SIZE: f32 = 9.5;
const CARD_BODY_FONT_SIZE: f32 = 10.5;
const TITLE_LINE_HEIGHT: f32 = 30.0;
const HEADING_LINE_HEIGHT: f32 = 18.0;
const BODY_LINE_HEIGHT: f32 = 16.0;
const CARD_TITLE_LINE_HEIGHT: f32 = 15.0;
const CARD_SUBTITLE_LINE_HEIGHT: f32 = 12.0;
const CARD_BODY_LINE_HEIGHT: f32 = 13.5;
const SECTION_GAP_PT: f32 = 14.0;
const BODY_PARAGRAPH_GAP_PT: f32 = 8.0;
const CARD_PADDING_X_PT: f32 = 10.0;
const CARD_PADDING_Y_PT: f32 = 8.0;
const CARD_INDENT_STEP_PT: f32 = 18.0;
const CARD_HEADER_GAP_PT: f32 = 3.0;
const CARD_BODY_GAP_PT: f32 = 4.0;
const CARD_CHILD_GAP_PT: f32 = 7.0;
const CARD_OUTER_GAP_PT: f32 = 10.0;
const CHARACTER_WIDTH_FACTOR: f32 = 0.52;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportPayload {
    pub title: String,
    pub body_paragraphs: Vec<String>,
    pub annotations: Vec<PdfAnnotationCard>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationCard {
    pub kind: PdfAnnotationCardKind,
    pub title: String,
    pub subtitle: Option<String>,
    pub body: Vec<String>,
    pub children: Vec<PdfAnnotationCard>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfAnnotationCardKind {
    Comment,
    Suggestion,
    Revision,
    Version,
}

#[derive(Clone, Copy)]
enum TextStyle {
    Title,
    Heading,
    Body,
    CardTitle,
    CardSubtitle,
    CardBody,
}

impl TextStyle {
    fn font(self) -> BuiltinFont {
        match self {
            Self::Title | Self::Heading | Self::CardTitle => BuiltinFont::HelveticaBold,
            Self::Body => BuiltinFont::TimesRoman,
            Self::CardSubtitle => BuiltinFont::HelveticaOblique,
            Self::CardBody => BuiltinFont::Helvetica,
        }
    }

    fn font_size(self) -> f32 {
        match self {
            Self::Title => TITLE_FONT_SIZE,
            Self::Heading => HEADING_FONT_SIZE,
            Self::Body => BODY_FONT_SIZE,
            Self::CardTitle => CARD_TITLE_FONT_SIZE,
            Self::CardSubtitle => CARD_SUBTITLE_FONT_SIZE,
            Self::CardBody => CARD_BODY_FONT_SIZE,
        }
    }

    fn line_height(self) -> f32 {
        match self {
            Self::Title => TITLE_LINE_HEIGHT,
            Self::Heading => HEADING_LINE_HEIGHT,
            Self::Body => BODY_LINE_HEIGHT,
            Self::CardTitle => CARD_TITLE_LINE_HEIGHT,
            Self::CardSubtitle => CARD_SUBTITLE_LINE_HEIGHT,
            Self::CardBody => CARD_BODY_LINE_HEIGHT,
        }
    }

    fn baseline_offset(self) -> f32 {
        self.font_size() * 0.9
    }
}

#[derive(Clone, Copy)]
struct CardLayer {
    id: usize,
    kind: PdfAnnotationCardKind,
    depth: usize,
    left_pt: f32,
    right_pt: f32,
}

#[derive(Clone)]
struct FlowLine {
    text: String,
    style: TextStyle,
    x_pt: f32,
    gap_after_pt: f32,
    card_layers: Vec<CardLayer>,
}

#[derive(Clone)]
struct PlacedLine {
    text: String,
    style: TextStyle,
    x_pt: f32,
    top_y_pt: f32,
    bottom_y_pt: f32,
    card_layers: Vec<CardLayer>,
}

struct FlowBuilder {
    next_card_id: usize,
    lines: Vec<FlowLine>,
}

impl FlowBuilder {
    fn new() -> Self {
        Self {
            next_card_id: 0,
            lines: Vec::new(),
        }
    }

    fn new_card_layer(
        &mut self,
        kind: PdfAnnotationCardKind,
        depth: usize,
        left_pt: f32,
        right_pt: f32,
    ) -> CardLayer {
        let layer = CardLayer {
            id: self.next_card_id,
            kind,
            depth,
            left_pt,
            right_pt,
        };
        self.next_card_id += 1;
        layer
    }
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
        let mut ops = Vec::new();
        render_card_segments(&page_lines, &mut ops);
        render_text_lines(&page_lines, &mut ops);
        document
            .pages
            .push(PdfPage::new(Mm(PAGE_WIDTH_MM), Mm(PAGE_HEIGHT_MM), ops));
    }

    document
}

fn build_flow_lines(payload: &PdfExportPayload) -> Vec<FlowLine> {
    let mut builder = FlowBuilder::new();
    let left_pt = mm_to_pt(MARGIN_MM);
    let right_pt = mm_to_pt(PAGE_WIDTH_MM - MARGIN_MM);
    let width_pt = right_pt - left_pt;

    push_wrapped_block(
        &mut builder.lines,
        &payload.title,
        TextStyle::Title,
        left_pt,
        width_pt,
        &[],
        SECTION_GAP_PT,
    );

    if payload.body_paragraphs.is_empty() {
        builder.lines.push(FlowLine {
            text: String::new(),
            style: TextStyle::Body,
            x_pt: left_pt,
            gap_after_pt: BODY_PARAGRAPH_GAP_PT,
            card_layers: Vec::new(),
        });
    } else {
        for paragraph in &payload.body_paragraphs {
            push_wrapped_block(
                &mut builder.lines,
                paragraph,
                TextStyle::Body,
                left_pt,
                width_pt,
                &[],
                BODY_PARAGRAPH_GAP_PT,
            );
        }
    }

    if !payload.annotations.is_empty() {
        push_wrapped_block(
            &mut builder.lines,
            "Annotations",
            TextStyle::Heading,
            left_pt,
            width_pt,
            &[],
            BODY_PARAGRAPH_GAP_PT,
        );

        for annotation in &payload.annotations {
            push_annotation_card(&mut builder, annotation, 0, &[], CARD_OUTER_GAP_PT);
        }
    }

    if let Some(last) = builder.lines.last_mut() {
        last.gap_after_pt = 0.0;
    }

    builder.lines
}

fn push_annotation_card(
    builder: &mut FlowBuilder,
    card: &PdfAnnotationCard,
    depth: usize,
    ancestors: &[CardLayer],
    gap_after_pt: f32,
) {
    let card_left_pt = mm_to_pt(MARGIN_MM) + depth as f32 * CARD_INDENT_STEP_PT;
    let card_right_pt = mm_to_pt(PAGE_WIDTH_MM - MARGIN_MM);
    let content_x_pt = card_left_pt + CARD_PADDING_X_PT;
    let content_width_pt = (card_right_pt - card_left_pt - CARD_PADDING_X_PT * 2.0).max(80.0);

    let layer = builder.new_card_layer(card.kind, depth, card_left_pt, card_right_pt);
    let mut card_layers = ancestors.to_vec();
    card_layers.push(layer);

    let mut pushed_any = false;
    pushed_any |= push_wrapped_block(
        &mut builder.lines,
        &card.title,
        TextStyle::CardTitle,
        content_x_pt,
        content_width_pt,
        &card_layers,
        0.0,
    );

    if let Some(subtitle) = &card.subtitle {
        add_gap_to_last_line(&mut builder.lines, CARD_HEADER_GAP_PT);
        pushed_any |= push_wrapped_block(
            &mut builder.lines,
            subtitle,
            TextStyle::CardSubtitle,
            content_x_pt,
            content_width_pt,
            &card_layers,
            0.0,
        );
    }

    for body_line in &card.body {
        add_gap_to_last_line(&mut builder.lines, CARD_BODY_GAP_PT);
        pushed_any |= push_wrapped_block(
            &mut builder.lines,
            body_line,
            TextStyle::CardBody,
            content_x_pt,
            content_width_pt,
            &card_layers,
            0.0,
        );
    }

    for child in &card.children {
        add_gap_to_last_line(&mut builder.lines, CARD_CHILD_GAP_PT);
        push_annotation_card(builder, child, depth + 1, &card_layers, 0.0);
        pushed_any = true;
    }

    if !pushed_any {
        builder.lines.push(FlowLine {
            text: String::new(),
            style: TextStyle::CardBody,
            x_pt: content_x_pt,
            gap_after_pt: 0.0,
            card_layers,
        });
    }

    add_gap_to_last_line(&mut builder.lines, gap_after_pt);
}

fn push_wrapped_block(
    lines: &mut Vec<FlowLine>,
    text: &str,
    style: TextStyle,
    x_pt: f32,
    width_pt: f32,
    card_layers: &[CardLayer],
    gap_after_pt: f32,
) -> bool {
    let max_chars = max_chars_for_width(style, width_pt);
    let mut block_lines = wrap(text, max_chars);
    if block_lines.is_empty() {
        return false;
    }

    let last_index = block_lines.len().saturating_sub(1);
    for (index, line) in block_lines.drain(..).enumerate() {
        lines.push(FlowLine {
            text: line.to_string(),
            style,
            x_pt,
            gap_after_pt: if index == last_index {
                gap_after_pt
            } else {
                0.0
            },
            card_layers: card_layers.to_vec(),
        });
    }

    true
}

fn add_gap_to_last_line(lines: &mut [FlowLine], gap_after_pt: f32) {
    if gap_after_pt <= 0.0 {
        return;
    }
    if let Some(last) = lines.last_mut() {
        last.gap_after_pt += gap_after_pt;
    }
}

fn max_chars_for_width(style: TextStyle, width_pt: f32) -> usize {
    let approx_char_width_pt = style.font_size() * CHARACTER_WIDTH_FACTOR;
    ((width_pt / approx_char_width_pt).floor() as usize).max(8)
}

fn paginate_lines(flow: &[FlowLine]) -> Vec<Vec<PlacedLine>> {
    let mut pages = vec![Vec::new()];
    let page_top_y_pt = mm_to_pt(PAGE_HEIGHT_MM - MARGIN_MM);
    let page_bottom_y_pt = mm_to_pt(MARGIN_MM);
    let mut current_top_y_pt = page_top_y_pt;

    for line in flow {
        let line_height_pt = line.style.line_height();
        if current_top_y_pt - line_height_pt < page_bottom_y_pt {
            pages.push(Vec::new());
            current_top_y_pt = page_top_y_pt;
        }

        let top_y_pt = current_top_y_pt;
        let bottom_y_pt = top_y_pt - line_height_pt;
        pages
            .last_mut()
            .expect("at least one page")
            .push(PlacedLine {
                text: line.text.clone(),
                style: line.style,
                x_pt: line.x_pt,
                top_y_pt,
                bottom_y_pt,
                card_layers: line.card_layers.clone(),
            });

        current_top_y_pt = bottom_y_pt - line.gap_after_pt;
    }

    pages
}

#[derive(Clone, Copy)]
struct CardSegment {
    layer: CardLayer,
    top_y_pt: f32,
    bottom_y_pt: f32,
}

fn render_card_segments(page_lines: &[PlacedLine], ops: &mut Vec<Op>) {
    let mut segments = BTreeMap::<usize, CardSegment>::new();

    for line in page_lines {
        for layer in &line.card_layers {
            let entry = segments.entry(layer.id).or_insert(CardSegment {
                layer: *layer,
                top_y_pt: line.top_y_pt,
                bottom_y_pt: line.bottom_y_pt,
            });
            entry.top_y_pt = entry.top_y_pt.max(line.top_y_pt);
            entry.bottom_y_pt = entry.bottom_y_pt.min(line.bottom_y_pt);
        }
    }

    let mut ordered_segments = segments.into_values().collect::<Vec<_>>();
    ordered_segments.sort_by_key(|segment| segment.layer.depth);

    for segment in ordered_segments {
        let top_y_pt = segment.top_y_pt + CARD_PADDING_Y_PT;
        let bottom_y_pt = segment.bottom_y_pt - CARD_PADDING_Y_PT;
        let polygon = rectangle_polygon(
            segment.layer.left_pt,
            top_y_pt,
            segment.layer.right_pt,
            bottom_y_pt,
        );

        ops.push(Op::SetFillColor {
            col: card_fill_color(segment.layer.kind, segment.layer.depth),
        });
        ops.push(Op::SetOutlineColor {
            col: card_outline_color(segment.layer.kind),
        });
        ops.push(Op::SetOutlineThickness { pt: Pt(0.8) });
        ops.push(Op::DrawPolygon { polygon });
    }
}

fn render_text_lines(page_lines: &[PlacedLine], ops: &mut Vec<Op>) {
    for line in page_lines {
        let font = line.style.font();
        let cursor_y_pt = line.top_y_pt - line.style.baseline_offset();

        ops.push(Op::StartTextSection);
        ops.push(Op::SetTextCursor {
            pos: point_from_pt(line.x_pt, cursor_y_pt),
        });
        ops.push(Op::SetFillColor {
            col: rgb_color(0.12, 0.16, 0.22),
        });
        ops.push(Op::SetFontSizeBuiltinFont {
            size: Pt(line.style.font_size()),
            font,
        });
        ops.push(Op::WriteTextBuiltinFont {
            items: vec![TextItem::Text(line.text.clone())],
            font,
        });
        ops.push(Op::EndTextSection);
    }
}

fn rectangle_polygon(left_pt: f32, top_pt: f32, right_pt: f32, bottom_pt: f32) -> Polygon {
    Polygon {
        rings: vec![PolygonRing {
            points: vec![
                LinePoint {
                    p: point_from_pt(left_pt, top_pt),
                    bezier: false,
                },
                LinePoint {
                    p: point_from_pt(right_pt, top_pt),
                    bezier: false,
                },
                LinePoint {
                    p: point_from_pt(right_pt, bottom_pt),
                    bezier: false,
                },
                LinePoint {
                    p: point_from_pt(left_pt, bottom_pt),
                    bezier: false,
                },
            ],
        }],
        mode: PaintMode::FillStroke,
        winding_order: WindingOrder::NonZero,
    }
}

fn card_fill_color(kind: PdfAnnotationCardKind, depth: usize) -> Color {
    let (r, g, b) = match kind {
        PdfAnnotationCardKind::Comment => (0.992, 0.969, 0.867),
        PdfAnnotationCardKind::Suggestion => (0.91, 0.965, 0.925),
        PdfAnnotationCardKind::Revision => (0.94, 0.925, 0.992),
        PdfAnnotationCardKind::Version => (0.949, 0.957, 0.973),
    };
    let depth_shift = (depth as f32 * 0.018).min(0.08);
    rgb_color(
        (r - depth_shift).max(0.75),
        (g - depth_shift).max(0.75),
        (b - depth_shift).max(0.75),
    )
}

fn card_outline_color(kind: PdfAnnotationCardKind) -> Color {
    match kind {
        PdfAnnotationCardKind::Comment => rgb_color(0.851, 0.718, 0.349),
        PdfAnnotationCardKind::Suggestion => rgb_color(0.388, 0.702, 0.557),
        PdfAnnotationCardKind::Revision => rgb_color(0.565, 0.49, 0.875),
        PdfAnnotationCardKind::Version => rgb_color(0.647, 0.706, 0.804),
    }
}

fn rgb_color(r: f32, g: f32, b: f32) -> Color {
    Color::Rgb(Rgb {
        r,
        g,
        b,
        icc_profile: None,
    })
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
    use printpdf::{Op, PdfParseOptions};

    use super::{
        build_flow_lines, paginate_lines, render_pdf_bytes, PdfAnnotationCard,
        PdfAnnotationCardKind, PdfExportPayload,
    };

    fn sample_payload() -> PdfExportPayload {
        PdfExportPayload {
            title: "Test Document".to_string(),
            body_paragraphs: vec!["Hello world".to_string()],
            annotations: vec![PdfAnnotationCard {
                kind: PdfAnnotationCardKind::Comment,
                title: "1. Comment (0-5)".to_string(),
                subtitle: Some("On: \"Hello\"".to_string()),
                body: vec!["Alice: Nice greeting!".to_string()],
                children: vec![PdfAnnotationCard {
                    kind: PdfAnnotationCardKind::Version,
                    title: "Version 1".to_string(),
                    subtitle: None,
                    body: vec!["Nested child".to_string()],
                    children: Vec::new(),
                }],
            }],
        }
    }

    #[test]
    fn renders_valid_pdf_bytes() {
        let bytes = render_pdf_bytes(&sample_payload());
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 500);
    }

    #[test]
    fn renders_card_polygons_for_annotations() {
        let bytes = render_pdf_bytes(&sample_payload());
        let parsed =
            printpdf::PdfDocument::parse(&bytes, &PdfParseOptions::default(), &mut Vec::new())
                .unwrap();
        let polygon_count = parsed.pages[0]
            .ops
            .iter()
            .filter(|op| matches!(op, Op::DrawPolygon { .. }))
            .count();

        assert!(polygon_count >= 2);
    }

    #[test]
    fn resets_text_section_for_each_rendered_line() {
        let bytes = render_pdf_bytes(&sample_payload());
        let parsed =
            printpdf::PdfDocument::parse(&bytes, &PdfParseOptions::default(), &mut Vec::new())
                .unwrap();
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
