// The report users see first: three pages of AG Studio widgets. Field ids refer to the data
// sources in ./data.ts. The headline numbers live in the shelf above Studio (dashboard.tsx), so
// the canvas starts straight on the analysis.

import type { AgReportState, AgWidgetLayoutState } from 'ag-studio';

// Position on the canvas grid, in tracks: 24 columns wide.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

export const PAGES = [
  { id: 'value', label: 'Value' },
  { id: 'categories', label: 'Categories' },
  { id: 'trends', label: 'Trends' },
];

export function buildReport(currency: string): AgReportState {
  const value = {
    id: 'value',
    widgets: {
      board: {
        type: 'valueBoard',
        dataMapping: { label: [{ id: 'subscriptions.name' }], score: [sum('subscriptions.valueScore')], cost: [sum('subscriptions.monthlyCost')], hours: [sum('subscriptions.hours30')] },
        format: title('Is each subscription earning its place?'),
      },
      'cost-per-hour': {
        type: 'bar-chart-grouped',
        dataMapping: { categoryKey: [{ id: 'subscriptions.name' }], valueKey: [sum('subscriptions.costPerHour')] },
        sort: [{ field: sum('subscriptions.costPerHour'), direction: 'desc' }],
        format: title(`Cost per hour of use (${currency})`),
      },
      'spend-vs-use': {
        type: 'bubble-chart',
        dataMapping: { categoryKey: [sum('subscriptions.hours30')], valueKey: [sum('subscriptions.monthlyCost')], groupByKey: [{ id: 'subscriptions.name' }], sizeKey: [sum('subscriptions.monthlyCost')] },
        format: title('What you pay against how much you use it'),
      },
      'by-verdict': {
        type: 'treemap-chart',
        dataMapping: { categoryKey: [{ id: 'subscriptions.verdict' }, { id: 'subscriptions.name' }], valueKey: [sum('subscriptions.monthlyCost')] },
        format: title('Where the money goes, by verdict'),
      },
      table: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'subscriptions.name' },
            { id: 'subscriptions.category' },
            { id: 'subscriptions.billedVia' },
            { id: 'subscriptions.verdict' },
            { id: 'subscriptions.recommendation' },
            sum('subscriptions.monthlyCost'),
            sum('subscriptions.hours30'),
            sum('subscriptions.costPerHour'),
            sum('subscriptions.valueScore'),
            sum('subscriptions.savings'),
          ],
        },
        sort: [{ field: sum('subscriptions.savings'), direction: 'desc' }],
        format: title('All subscriptions, biggest saving first'),
      },
    },
    widgetLayout: {
      board: at(0, 0, 11, 30),
      'cost-per-hour': at(11, 0, 13, 15),
      'spend-vs-use': at(11, 15, 13, 15),
      'by-verdict': at(0, 30, 24, 16),
      table: at(0, 46, 24, 22),
    },
  };

  const categories = {
    id: 'categories',
    widgets: {
      filter: {
        type: 'button-filter',
        dataMapping: { value: [{ id: 'subscriptions.category' }] },
        format: { ...title('Category'), style: { dimensions: { height: 28, minWidth: 48 } } },
      },
      'spend-by-category': {
        type: 'donut-chart',
        dataMapping: { categoryKey: [{ id: 'subscriptions.category' }], valueKey: [sum('subscriptions.monthlyCost')] },
        format: { ...title(`Monthly spend by category (${currency})`), ...legend },
      },
      breakdown: {
        type: 'sunburst-chart',
        dataMapping: { categoryKey: [{ id: 'subscriptions.category' }, { id: 'subscriptions.name' }], valueKey: [sum('subscriptions.monthlyCost')] },
        format: title('Category, then subscription'),
      },
      'hours-by-category': {
        type: 'bar-chart-grouped',
        dataMapping: { categoryKey: [{ id: 'subscriptions.category' }], valueKey: [sum('subscriptions.hours30')] },
        sort: [{ field: sum('subscriptions.hours30'), direction: 'desc' }],
        format: title('Hours used in the last 30 days, by category'),
      },
      'classified-by': {
        type: 'grid',
        dataMapping: { cols: [{ id: 'subscriptions.name' }, { id: 'subscriptions.category' }, { id: 'subscriptions.classifiedBy' }, { id: 'subscriptions.foundThrough' }, sum('subscriptions.monthlyCost')] },
        sort: [{ field: { id: 'subscriptions.category' }, direction: 'asc' }],
        format: title('How each subscription was classified'),
      },
    },
    widgetLayout: {
      filter: at(0, 0, 24, 6),
      'spend-by-category': at(0, 6, 8, 20),
      breakdown: at(8, 6, 8, 20),
      'hours-by-category': at(16, 6, 8, 20),
      'classified-by': at(0, 26, 24, 22),
    },
  };

  const trends = {
    id: 'trends',
    widgets: {
      'usage-by-week': {
        type: 'column-chart-stacked',
        dataMapping: { categoryKey: [{ id: 'calendar::week' }], valueKey: [sum('usage.hours')], legendKey: [{ id: 'subscriptions.name' }] },
        format: { ...title('Hours of use per week'), ...legend },
      },
      'charges-by-month': {
        type: 'column-chart-stacked',
        dataMapping: { categoryKey: [{ id: 'calendar::month' }], valueKey: [sum('charges.amount')], legendKey: [{ id: 'subscriptions.category' }] },
        format: { ...title(`Charged per month, by category (${currency})`), ...legend },
      },
      'charge-line': {
        type: 'line-chart',
        dataMapping: { categoryKey: [{ id: 'calendar::month' }], valueKey: [sum('charges.amount')] },
        format: title('Total charged per month'),
      },
      charges: {
        type: 'grid',
        dataMapping: { cols: [{ id: 'charges.date' }, { id: 'subscriptions.name' }, { id: 'charges.status' }, sum('charges.amount')] },
        sort: [{ field: { id: 'charges.date' }, direction: 'desc' }],
        format: title('Charge history'),
      },
    },
    widgetLayout: {
      'charges-by-month': at(0, 0, 14, 20),
      'charge-line': at(14, 0, 10, 20),
      'usage-by-week': at(0, 20, 14, 22),
      charges: at(14, 20, 10, 22),
    },
  };

  // Typed loosely: the valueBoard widget type is registered at runtime, outside Studio's default registry.
  return {
    selectedPageId: value.id,
    pages: [value, categories, trends],
    // The filters panel starts collapsed so the report gets the full width.
    panels: { filters: { collapsed: true } },
  } as unknown as AgReportState;
}
