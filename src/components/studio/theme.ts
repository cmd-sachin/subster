// AG Studio theme for the Analytics page, in the app palette (see styles/app.css): #030407
// canvas, flat dark cards, lime as the accent and first series, blue as the second.

import { studioTheme } from 'ag-studio';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Outfit Variable", system-ui, sans-serif';
const LINE = 'rgba(255, 255, 255, 0.09)';
const line = { width: 1, color: LINE };

const SERIES = ['#d4ff24', '#1558c9', '#7aa7f7', '#2fd4b5', '#ffb547', '#c9d1dc', '#e05cff', '#ff6b6b', '#8fb300', '#5d6b82'];
const palette = Object.fromEntries(
  SERIES.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);

export const subsenseStudioTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: '#f3f5f7',
  foregroundColor: '#f3f5f7',
  subtleTextColor: '#9aa1ad',
  backgroundColor: '#0b0e13',
  borderColor: LINE,
  accentColor: '#d4ff24',
  iconColor: '#9aa1ad',
  rowHoverColor: 'rgba(255, 255, 255, 0.06)',

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: '#030407',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: '#030407',
  studioCanvasPadding: 20,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: '#0b0e13',
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: '#f3f5f7',
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleTextColor: '#9aa1ad',
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionTextColor: '#9aa1ad',
  studioWidgetResizeBorderColor: '#d4ff24',

  studioPanelContainerBackgroundColor: '#0b0e13',
  studioPanelContainerBorder: line,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: LINE,
  studioPanelDividerActiveColor: '#d4ff24',
  studioPanelSectionBorderColor: LINE,
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 700,
  studioToggleButtonActiveBackgroundColor: 'rgba(212, 255, 36, 0.14)',
  studioToggleButtonActiveBorderColor: '#d4ff24',
  studioToggleButtonActiveColor: '#d4ff24',

  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: '#f3f5f7',
  gridHeaderBackgroundColor: 'transparent',
  gridHeaderTextColor: '#9aa1ad',
  gridHeaderFontWeight: 600,
  gridRowHeight: 40,
  gridRowBorder: line,
  gridHeaderRowBorder: line,
  gridRowHoverColor: 'rgba(255, 255, 255, 0.06)',
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: '#f3f5f7',
  chartSubtleTextColor: '#9aa1ad',
  chartAxisLineColor: 'rgba(255, 255, 255, 0.14)',
  chartGridLineColor: 'rgba(255, 255, 255, 0.07)',
  ...palette,
});
