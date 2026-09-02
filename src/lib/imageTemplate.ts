// Shared model + HTML builder for the legacy image-certificate designer
// (DocumentManagerController::renderImageTempalte()). An admin positions one text block and one
// photo box over a full-bleed background image; legacy rendered this to an image via an external
// microservice, this app renders the same absolute-positioned HTML locally (client canvas for the
// certificate download, and as the email body for the birthday wish — exactly as legacy's
// MsgHTML(renderImageTempalte(...)) did).

export interface ImageTemplate {
  id: number;
  name: string | null;
  type: string | null;
  image: string | null;
  imageLeft: number;
  imageTop: number;
  imagesize: number;
  imageHeight: number;
  is_default: number;
  text_content: string | null;
  left_axis: number;
  top_axis: number;
}

// The background canvas legacy assumes (renderImageTempalte hard-codes 899x880).
export const CANVAS_WIDTH = 899;
export const CANVAS_HEIGHT = 880;

// Legacy's renderImageTempalte does str_replace on {{first_name}} / {{last_name}}; keep that exact
// spelling and add the other tokens buildMergeTokens already resolves so templates can use them.
export function resolveTemplateText(textContent: string, tokens: Record<string, string>): string {
  let out = textContent ?? '';
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value ?? '');
  }
  return out;
}

// Mirrors renderImageTempalte()'s markup (photo box, then text block offset by +60px, over the
// background image). Returned as a self-contained fragment usable both as an email body and as
// the source for a client-side canvas render.
export function buildTemplateHtml(
  template: Pick<ImageTemplate, 'image' | 'imageLeft' | 'imageTop' | 'imagesize' | 'imageHeight' | 'left_axis' | 'top_axis'>,
  resolvedText: string,
  photoUrl: string
): string {
  const bg = template.image ?? '';
  return `
<div style="position:relative;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;">
  <img src="${bg}" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" alt="" style="position:absolute;top:0;left:0;object-fit:contain;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;" />
  ${photoUrl ? `<div style="position:absolute;border:1px solid #ccc;width:${template.imagesize}px;height:${template.imageHeight}px;top:${template.imageTop}px;left:${template.imageLeft}px;overflow:hidden;">
    <img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;" />
  </div>` : ''}
  <div style="position:absolute;top:${Number(template.top_axis) + 60}px;left:${template.left_axis}px;">
    <p style="margin:0;">${resolvedText}</p>
  </div>
</div>`.trim();
}
