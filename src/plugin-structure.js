'use strict';
// These plugins are interpreted by the block parser, not ordinary render handlers.
module.exports = {
  editableIncludes: ['table_edit'],
  contents: ['contents', 'contents_line'],
  includes: ['include', 'inc', 'include_cache', 'include_random', 'splitinclude'],
  tableBefore: ['table_style', 'table_color', 'table_filter'],
  tableAfter: ['table_zebra', 'table_sorter', 'table_autoincrement'],
  regions: ['region', 'endregion'],
};
