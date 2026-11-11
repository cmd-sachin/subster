// AG Studio theme for the Analytics page, in the app palette (see styles/app.css): light
// page, white cards, ink as the accent, the logo's blue as the first series.

import { studioTheme } from 'ag-studio';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter Variable", system-ui, sans-serif';
const LINE = 'rgba(10, 30, 80, 0.08)';
const line = { width: 1, color: LINE };

const SERIES = ['#0473fd', '#fdb10e', '#6aa8ff', '#0c9a68', '#ff9f43', '#b9bdd0', '#e05cff', '#ff6b6b', '#fdb10e', '#5d6b82'];
const palette = Object.fromEntries(
  SERIES.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);

export const substerStudioTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: '#0a1633',
  foregroundColor: '#0a1633',
  subtleTextColor: '#55607a',
  backgroundColor: '#ffffff',
  borderColor: LINE,
  accentColor: '#0473fd',
  iconColor: '#55607a',
  rowHoverColor: 'rgba(10, 30, 80, 0.04)',

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: 'transparent',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: 'transparent',
  studioCanvasPadding: 20,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: '#ffffff',
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: '#0a1633',
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleTextColor: '#55607a',
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionTextColor: '#55607a',
  studioWidgetResizeBorderColor: '#0473fd',

  studioPanelContainerBackgroundColor: '#ffffff',
  studioPanelContainerBorder: line,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: LINE,
  studioPanelDividerActiveColor: '#0473fd',
  studioPanelSectionBorderColor: LINE,
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 700,
  studioToggleButtonActiveBackgroundColor: 'rgba(4, 115, 253, 0.09)',
  studioToggleButtonActiveBorderColor: '#0473fd',
  studioToggleButtonActiveColor: '#0473fd',

  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: '#0a1633',
  gridHeaderBackgroundColor: 'transparent',
  gridHeaderTextColor: '#55607a',
  gridHeaderFontWeight: 600,
  gridRowHeight: 40,
  gridRowBorder: line,
  gridHeaderRowBorder: line,
  gridRowHoverColor: 'rgba(10, 30, 80, 0.04)',
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: '#0a1633',
  chartSubtleTextColor: '#55607a',
  chartAxisLineColor: 'rgba(10, 30, 80, 0.16)',
  chartGridLineColor: 'rgba(10, 30, 80, 0.07)',
  ...palette,
});
