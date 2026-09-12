/**
 * Chrome's internal accessibility role strings -> our closed Role enum. Keyed
 * lowercase since Chrome's own casing is inconsistent (probed: "LayoutTableCell" but
 * "generic", "none", "form" -- lowercase). Anything not listed maps to 'unknown' rather
 * than guessing; extend this table empirically as new markup is encountered.
 *
 * SKIP_ROLES are dropped from the flattened node list entirely: RootWebArea/Iframe are
 * structural entry points already handled via frameId, InlineTextBox duplicates the
 * StaticText one level up, and "none"/"presentation" carry no signal.
 */
import type { Role } from './observation';

const ROLE_MAP: Record<string, Role> = {
  button: 'button',
  link: 'link',
  textbox: 'textbox',
  searchbox: 'textbox',
  checkbox: 'checkbox',
  radiobutton: 'radio',
  popupbutton: 'combobox',
  comboboxselect: 'combobox',
  comboboxmenubutton: 'combobox',
  textfieldwithcombobox: 'combobox',
  cell: 'cell',
  gridcell: 'cell',
  layouttablecell: 'cell',
  columnheader: 'cell',
  rowheader: 'cell',
  row: 'row',
  layouttablerow: 'row',
  table: 'table',
  layouttable: 'table',
  grid: 'table',
  heading: 'heading',
  statictext: 'text',
  dialog: 'dialog',
  alertdialog: 'dialog',
  form: 'form',
  list: 'list',
  listitem: 'listitem',
  image: 'image',
  img: 'image',
  region: 'region',
  landmark: 'region',
  main: 'region',
  navigation: 'region',
  banner: 'region',
  contentinfo: 'region',
  group: 'region',
};

const SKIP_ROLES = new Set(['rootwebarea', 'iframe', 'none', 'inlinetextbox', 'linebreak', 'presentation']);

export function mapChromeRole(chromeRole: string): Role | 'skip' {
  const key = chromeRole.toLowerCase();
  if (SKIP_ROLES.has(key)) return 'skip';
  return ROLE_MAP[key] ?? 'unknown';
}
