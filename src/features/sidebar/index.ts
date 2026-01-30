/**
 * Sidebar Components
 *
 * Exports:
 * - Sidebar: Main sidebar navigator component
 * - DBTree: Expandable database tree
 * - TableItem: Individual schema item (table/view/index)
 */

export { Sidebar } from './Sidebar';
export type { SidebarProps } from './Sidebar';

export { DBTree } from './DBTree';
export type { DBTreeProps, DBTreeSchema, DBContextAction, SchemaContextAction } from './DBTree';

export { TableItem, HighlightedText } from './TableItem';
export type { TableItemProps, SchemaItemType } from './TableItem';
