// AG Studio theme for the Analytics page, in the app palette (see styles/app.css): #02030c
// canvas, flat dark cards, lime as the accent and first series, blue as the second.

import { studioTheme } from 'ag-studio';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter Variable", system-ui, sans-serif';
const LINE = 'rgba(255, 255, 255, 0.09)';
const line = { width: 1, color: LINE };

const SERIES = ['#fed106', '#0473fd', '#6aa8ff', '#34d399', '#ff9f43', '#c9d1dc', '#e05cff', '#ff6b6b', '#fdb10e', '#5d6b82'];
const palette = Object.fromEntries(
  SERIES.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);

export const substerStudioTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: '#f5f7fb',
  foregroundColor: '#f5f7fb',
  subtleTextColor: '#a3abbd',
  backgroundColor: '#080b18',
  borderColor: LINE,
  accentColor: '#fed106',
  iconColor: '#a3abbd',
  rowHoverColor: 'rgba(255, 255, 255, 0.06)',

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: '#02030c',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: '#02030c',
  studioCanvasPadding: 20,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: '#080b18',
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: '#f5f7fb',
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleTextColor: '#a3abbd',
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionTextColor: '#a3abbd',
  studioWidgetResizeBorderColor: '#fed106',

  studioPanelContainerBackgroundColor: '#080b18',
  studioPanelContainerBorder: line,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: LINE,
  studioPanelDividerActiveColor: '#fed106',
  studioPanelSectionBorderColor: LINE,
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 700,
  studioToggleButtonActiveBackgroundColor: 'rgba(254, 209, 6, 0.14)',
  studioToggleButtonActiveBorderColor: '#fed106',
  studioToggleButtonActiveColor: '#fed106',

  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: '#f5f7fb',
  gridHeaderBackgroundColor: 'transparent',
  gridHeaderTextColor: '#a3abbd',
  gridHeaderFontWeight: 600,
  gridRowHeight: 40,
  gridRowBorder: line,
  gridHeaderRowBorder: line,
  gridRowHoverColor: 'rgba(255, 255, 255, 0.06)',
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: '#f5f7fb',
  chartSubtleTextColor: '#a3abbd',
  chartAxisLineColor: 'rgba(255, 255, 255, 0.14)',
  chartGridLineColor: 'rgba(255, 255, 255, 0.07)',
  ...palette,
});
