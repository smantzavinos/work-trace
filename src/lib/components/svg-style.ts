// Styling that lives inside the <svg> so the chart stays self-contained (e.g. for export).
// Colours are mostly presentation attributes on the elements; this holds typography and
// interaction affordances only (no external fonts: a system sans stack).
import { FONT_STACK } from '../layout/text.js';

export const SVG_CSS = `
.at-root{font-family:${FONT_STACK};font-size:12px}
.at-bar,.at-marker,.at-region,.at-chip,.at-cluster{cursor:pointer;outline:none}
.at-focus{fill:none;stroke:none;pointer-events:none}
.at-bar:focus-visible .at-focus,.at-marker:focus-visible .at-focus,.at-chip:focus-visible .at-focus{stroke:#2f5fd0;stroke-width:2}
.at-bar:hover .at-body{filter:brightness(1.06)}
.at-label{font-size:12px;font-weight:500;pointer-events:none;user-select:none}
.at-label-light{font-weight:400}
.at-pause{font-size:10.5px;font-variant-numeric:tabular-nums;user-select:none}
.at-handoff-kind{font-size:10.5px;font-weight:500;user-select:none}
.at-work-title{font-size:10.5px;font-weight:600;letter-spacing:0.01em;user-select:none}
.at-run-tag{opacity:.78;font-variant-numeric:tabular-nums}
.at-step-num{font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;user-select:none}
.at-glyph{font-size:10px;font-weight:700;pointer-events:none;user-select:none}
.at-tick-label{fill:#6b7280;font-size:11px;font-variant-numeric:tabular-nums;user-select:none}
.at-small{fill:#8a919e;font-size:10.5px;user-select:none}
.at-until-label{fill:#a85d12;font-size:10.5px;user-select:none}
.at-chip-text{font-size:11px;font-weight:600;user-select:none}
.at-chip-ref{font-weight:400}
.at-doc-title{fill:#1f2430;font-size:15px;font-weight:600}
.at-doc-meta{fill:#6b7280;font-size:11.5px}
.at-legend-text{fill:#3a4252;font-size:11px;font-weight:500;user-select:none}
.at-legend-title{fill:#8a919e;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;user-select:none}
.at-legend-note{fill:#8a919e;font-size:11px;font-weight:400;user-select:none}
`;
