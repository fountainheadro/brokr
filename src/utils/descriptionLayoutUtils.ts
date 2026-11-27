import {
  DescriptionGridItem,
  DescriptionGridRow,
  DescriptionPatternConfig,
  DescriptionSectionId,
  DescriptionSectionLayout,
} from "../core/automation/typ_title-automation";

export function getDescriptionSectionLayout(
  pattern: DescriptionPatternConfig | null | undefined,
  sectionId: DescriptionSectionId
): DescriptionSectionLayout | null {
  if (!pattern || !Array.isArray(pattern.sections)) return null;
  return pattern.sections.find((s) => s.sectionId === sectionId) || null;
}

export function isDescriptionSectionEnabled(
  pattern: DescriptionPatternConfig | null | undefined,
  sectionId: DescriptionSectionId
): boolean {
  const sec = getDescriptionSectionLayout(pattern, sectionId);
  return sec ? sec.enabled !== false : true;
}

export function hasCustomDescriptionRows(
  sec: DescriptionSectionLayout | null | undefined
): sec is DescriptionSectionLayout {
  return Boolean(sec && sec.enabled !== false && Array.isArray(sec.rows) && sec.rows.length > 0);
}

export function getGridColsClass(columnCount: number): string {
  switch (columnCount) {
    case 1:
      return "grid-cols-1";
    case 2:
      return "grid-cols-1 md:grid-cols-2";
    case 3:
      return "grid-cols-1 md:grid-cols-3";
    case 4:
      return "grid-cols-1 sm:grid-cols-2 md:grid-cols-4";
    default:
      return "grid-cols-1 md:grid-cols-2";
  }
}

export function isDividerOnlyRow(row: DescriptionGridRow): boolean {
  return row.columns.length === 1 && row.columns[0]?.kind === "divider";
}

export function getItemKey(item: DescriptionGridItem, rowIdx: number, colIdx: number): string {
  return item.id || `${rowIdx}_${colIdx}_${item.kind}_${item.tagId || ""}`;
}
