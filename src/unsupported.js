'use strict';
// Explicit exclusions, kept separate from unknown/misspelled plugin names.
const groups = {
  'サーバーの保存・認証・履歴・集計データが必要':
    'logined_mes recent_page_ref recent_ref link_upload link_diff link_rss link_tag link_backup link_ref tags tags_list list_read_only list_write_only list_by_tag list_by_tagsearch list_by_tagsearch_cache taglist_by_search tag_cloud popular threads popular_threads thread_posts link_newpage link_chmod link_popular link_contact link_contributor link_pdf linklist newpage loginform mailform tagsearch tagsearch2 comment comment_num comment_num2 pcomment vote vote2 vote3 tvote counter count_members online',
  '外部サービスの通信・埋め込みが必要':
    'news gnews irc pixiv soundcloud_widget gametrailers jumpcut minakuru_video im_vlog nifty_video dailymotion2 veoh nicovideo_com nicovideo_mylist nicovideo_series jimakuin mncast hatena_b_counter bookmark_yahoo bookmark_sphere bookmark_blogmarks bookmark_technorati bookmark_buzzurl bookmark_pookmark amazon amazon2 google_calendar slideshare googlemaps googlespreadsheets google_spsheet googlespreadsheets2 googlespreadsheets3 hatena_star facebook_like',
  'Flash・旧ブラウザーAPIに依存':
    'flash favorite homepage mp3blestar mikunano fullmiku flipbook_in',
  サーバー側の解析アルゴリズムを再現できません: 'seibun',
};
module.exports = Object.fromEntries(
  Object.entries(groups).flatMap(([reason, names]) =>
    names.split(' ').map((name) => [name, reason]),
  ),
);
