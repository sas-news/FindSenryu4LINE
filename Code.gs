/*
 * ============================================================
 * 川柳検出オットセイ
 *
 * LINE + Google Apps Script
 * Yahoo! JAPAN UniDic形態素解析API
 *
 * 対応:
 *   川柳  5-7-5
 *   短歌  5-7-5-7-7
 *   長歌  5-7 の繰り返し + 5-7-7
 * ============================================================
 */


/* ============================================================
 * 設定
 * ============================================================ */

const YAHOO_API_URL = 'https://jlp.yahooapis.jp/jsonrpc';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

// 長歌で探索する最大の 5-7 ペア数。
const MAX_CHOKA_PAIRS = 10;


/* ============================================================
 * LINE Webhook
 * ============================================================ */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    for (const event of body.events || []) {

      // テキストメッセージ以外は無視
      if (event.type !== 'message' || event.message?.type !== 'text') {
        continue;
      }

      const text = event.message.text;

      console.log(`受信: ${text}`);

      const result = detectPoetry(text);

      if (!result.found) {
        console.log('詩形なし');
        continue;
      }

      console.log(`${result.name}検出: ` + result.poem.lines.join(' / '));

      const reply = createPoetryReply(result);

      replyLine(event.replyToken, reply);
    }

  } catch (error) {
    console.error(error.stack || error);
  }

  /*
   * ContentServiceではなくHtmlService。
   * LINEのWebhook検証で302になる問題を避ける。
   */
  return HtmlService.createHtmlOutput('OK');
}


/* ============================================================
 * LINE返信
 * ============================================================ */

function replyLine(replyToken, text) {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty('LINE_CHANNEL_ACCESS_TOKEN');

  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
  }

  const response = UrlFetchApp.fetch(LINE_REPLY_URL, {
    method: 'post',

    contentType: 'application/json',

    headers: {
      Authorization: `Bearer ${token}`
    },

    payload: JSON.stringify({
      replyToken: replyToken,

      messages: [
        {
          type: 'text',
          text: text
        }
      ]
    }),

    muteHttpExceptions: true
  });

  const status = response.getResponseCode();

  if (status >= 300) {
    console.error(`LINE API ERROR ${status}: ` + response.getContentText());
  }
}


/* ============================================================
 * 返信メッセージ生成
 * ============================================================ */

function createPoetryReply(result) {
  const lines = result.poem.lines;

  switch (result.type) {

    case 'choka':
      return `🦭！？長歌を検出したおう！？\n「${lines.join(' ')}」`;

    case 'tanka':
      return `🦭短歌を検出したおう\n「${lines.join(' ')}」`;

    case 'haiku': {
      const kigo = result.kigo.primary;
      const season = getSeasonInfo(kigo.season);

      return (
        `🦭俳句を検出したおう\n` +
        `「${lines.join(' ')}」\n` +
        `${season.emoji}季語：${kigo.word}（${season.ja}）`
      );
    }

    case 'senryu':
      return `🦭川柳を検出したおう\n「${lines.join(' ')}」`;

    default:
      return `🦭なにかを検出したおう\n「${lines.join(' ')}」`;
  }
}


/* ============================================================
 * Yahoo! JAPAN UniDic形態素解析API
 * ============================================================ */

function analyzeUnidic(text) {
  const appId = PropertiesService
    .getScriptProperties()
    .getProperty('YAHOO_APP_ID');

  if (!appId) {
    throw new Error('YAHOO_APP_ID が設定されていません');
  }

  const payload = {
    id: Utilities.getUuid(),
    jsonrpc: '2.0',

    // ★ 形態素解析 → UniDic係り受け解析
    method: 'jlp.daservice.parse.unidic',

    params: {
      q: text
    }
  };

  const url = YAHOO_API_URL + '?appid=' + encodeURIComponent(appId);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const raw = response.getContentText();

  if (status !== 200) {
    throw new Error(`Yahoo API HTTP ${status}: ${raw}`);
  }

  const data = JSON.parse(raw);

  if (data.error) {
    throw new Error(`Yahoo API Error ${data.error.code}: ${data.error.message}`);
  }

  const chunks = data.result?.chunks;

  if (!Array.isArray(chunks)) {
    throw new Error(`不正なUniDic係り受けレスポンス: ${raw}`);
  }

  const result = [];

  for (const chunk of chunks) {
    const chunkTokens = chunk.tokens || [];

    for (let i = 0; i < chunkTokens.length; i++) {
      const token = chunkTokens[i];

      result.push({
        surface: token[0] ?? '',
        reading: token[1] ?? '',
        base: token[2] ?? '',
        pos: token[3] ?? '',
        posDetail: token[4] ?? '',
        conjugationType: token[5] ?? '',
        conjugationForm: token[6] ?? '',

        // ★ 文節情報
        chunkId: chunk.id,
        chunkHead: chunk.head,

        isChunkStart: i === 0,
        isChunkEnd: i === chunkTokens.length - 1
      });
    }
  }

  return result;
}


/* ============================================================
 * モーラ計算
 * ============================================================ */

function countMora(reading) {
  if (!reading) {
    return 0;
  }

  const text = reading
    .normalize('NFKC')
    .replace(/\s/g, '');

  /*
   * 小書き仮名は直前の仮名と合わせて
   * 1モーラなので単独では数えない。
   *
   * キョ → 1
   * ファ → 1
   *
   * 一方、
   * ッ
   * ン
   * ー
   *
   * はそれぞれ1モーラ。
   */
  const smallKana = new Set([
    'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'ゎ',
    'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ャ', 'ュ', 'ョ', 'ヮ'
  ]);

  let mora = 0;

  for (const char of text) {

    // 日本語の読み以外は数えない
    if (!/[ぁ-ゖァ-ヺー]/.test(char)) {
      continue;
    }

    if (smallKana.has(char)) {
      continue;
    }

    mora++;
  }

  return mora;
}


/* ============================================================
 * 形態素にモーラ情報追加
 * ============================================================ */

function addMoraInfo(tokens) {
  return tokens.map(token => ({
    ...token,
    mora: countMora(token.reading)
  }));
}


/* ============================================================
 * 詩形の開始位置判定
 * ============================================================ */

/**
 * 詩全体の開始位置。
 * これは比較的厳しくする。
 */
function canStartPoem(token) {
  if (!token || token.mora <= 0) {
    return false;
  }

  const pos = token.pos || '';
  const detail = token.posDetail || '';

  if (
    pos === '助詞' ||
    pos === '助動詞' ||
    pos === '接尾辞' ||
    pos === '補助記号' ||
    pos === '記号' ||
    pos === '空白'
  ) {
    return false;
  }

  if (detail.includes('接尾辞')) {
    return false;
  }

  return true;
}


/**
 * 2句目以降の開始位置。
 *
 * 「しまい」のような非自立可能動詞は許す。
 * 一方「が」「を」「で」などから始まるのは不可。
 *
 * (現状は canStartPoem と同じ判定基準)
 */
function canStartLine(token) {
  if (!token || token.mora <= 0) {
    return false;
  }

  const pos = token.pos || '';
  const detail = token.posDetail || '';

  if (
    pos === '助詞' ||
    pos === '助動詞' ||
    pos === '接尾辞' ||
    pos === '補助記号' ||
    pos === '記号' ||
    pos === '空白'
  ) {
    return false;
  }

  if (detail.includes('接尾辞')) {
    return false;
  }

  return true;
}


/* ============================================================
 * 句の終わり判定
 * ============================================================ */

/*
 * 以前は最後の「が」「で」なども
 * 厳しく弾いていたが、
 *
 * そういえば /
 * アニメーションは /
 * おもろいが
 *
 * のような偶然川柳を拾いたいので、
 * 現在はかなり緩め。
 */
function canEndPoem(token) {
  if (!token || token.mora <= 0) {
    return false;
  }

  const pos = token.pos || '';
  const detail = token.posDetail || '';
  const form = token.conjugationForm || '';

  if (form.includes('未然形')) {
    return false;
  }

  // 明確に後ろへ続く接続助詞だけ禁止
  if (pos === '助詞' && detail.includes('接続助詞')) {
    return false;
  }

  // 「よ」「ね」「な」など終助詞はOK
  return true;
}


/*
 * 促音（っ）だけで終わっていないか。
 *
 * 「よかった」の活用形「よかっ」＋助動詞「た」のように、
 * 促音便は必ず後ろに続く音があって初めて完成する。
 * 「してよかっ」のように促音で切れてしまうのは、
 * 本来の単語が途中で分断された誤検出の証拠なので、
 * 句の途中・最後を問わず終わりとして認めない。
 */
function endsWithDanglingSokuon(token) {
  if (!token) {
    return false;
  }

  const reading = String(token.reading || '')
    .normalize('NFKC')
    .replace(/\s/g, '');

  return reading.slice(-1) === 'ッ';
}


/* ============================================================
 * 文の区切り（境界）判定
 *
 * 改行や、絵文字・記号の連続（Wordleの■□マスなど）は
 * メッセージ内の別々の話題・行を区切っていることが多い。
 *
 * これをまたいで川柳・短歌を探してしまうと、
 * 「第1168回」の「回」と「お題：ぜじいうみゅん」の「お題」が
 * つながってしまうような、無関係な単語同士の誤検出が起きる。
 *
 * そのため、改行・絵文字・（句読点以外の）記号は
 * 「越えてはいけない境界」として扱い、そこで探索を打ち切る。
 *
 * 一方、「、」「。」「・」「ー」などの一般的な句読点は
 * 文中に挟まっても自然なので境界にしない。
 * ============================================================ */

// 詩の途中に挟まっても区切りにしない記号。
const SOFT_PUNCTUATION = new Set([
  '、', '。', '！', '？', '・', 'ー', '〜', '~',
  ',', '.', '!', '?', '-',
  ' ', '　', '\t'
]);

function isHardBreakToken(token) {
  const surface = String(token?.surface || '');

  if (!surface) {
    return false;
  }

  // 改行は明確な区切り
  if (/[\r\n\u2028\u2029]/.test(surface)) {
    return true;
  }

  // モーラを持つ（読み上げられる）形態素は区切りにしない
  if (token.mora > 0) {
    return false;
  }

  for (const ch of surface) {

    // 絵文字（🟩⬜🐝🦭⬆️など）は区切り
    if (/\p{Extended_Pictographic}/u.test(ch)) {
      return true;
    }

    // 許可した句読点以外の記号（顔文字・URLの記号など）は区切り
    if (!SOFT_PUNCTUATION.has(ch)) {
      return true;
    }
  }

  return false;
}


/* ============================================================
 * 任意のモーラパターン探索
 *
 * 例:
 *
 * [5,7,5]
 * [5,7,5,7,7]
 * ============================================================ */

function findPattern(tokens, targets) {
  for (let start = 0; start < tokens.length; start++) {

    if (!canStartPoem(tokens[start])) {
      continue;
    }

    let lineIndex = 0;
    let currentMora = 0;

    const lines = targets.map(() => []);
    const readings = targets.map(() => []);

    for (let i = start; i < tokens.length; i++) {
      const token = tokens[i];

      /*
       * 改行・絵文字・記号列などの境界をまたいで
       * 探索を続けると無関係な文がつながってしまうので、
       * この開始位置での探索はここで打ち切る。
       */
      if (isHardBreakToken(token)) {
        break;
      }

      if (token.mora === 0) {
        continue;
      }

      // 各句の先頭は自立語相当
      if (currentMora === 0 && !canStartLine(token)) {
        break;
      }

      currentMora += token.mora;

      lines[lineIndex].push(token.surface);
      readings[lineIndex].push(token.reading);

      if (currentMora > targets[lineIndex]) {
        break;
      }

      if (currentMora !== targets[lineIndex]) {
        continue;
      }

      /*
       * 促音（っ）だけで終わる句境界は認めない。
       * 「よかった」→「よかっ」のように、
       * 本来の単語が途中で切れているだけの可能性が高い。
       * （最終句に限らず、すべての句境界で見る）
       */
      if (endsWithDanglingSokuon(token)) {
        break;
      }

      const isLastLine = lineIndex === targets.length - 1;

      /*
       * 最終句だけは、
       * 完全にぶら下がった終わり方でないかを見る。
       */
      if (isLastLine) {
        if (!canEndPoem(token)) {
          break;
        }

        return {
          lines: lines.map(parts => parts.join('')),
          readings: readings.map(parts => parts.join('')),
          mora: [...targets],
          startToken: start,
          endToken: i
        };
      }

      /*
       * 次の有音形態素を探す。
       * 途中に改行・絵文字などの境界があれば、
       * それをまたいで次句を始めない。
       */
      let next = null;

      for (let j = i + 1; j < tokens.length; j++) {
        if (isHardBreakToken(tokens[j])) {
          break;
        }

        if (tokens[j].mora > 0) {
          next = tokens[j];
          break;
        }
      }

      /*
       * 次句が自然に始められないなら、
       * ここは句境界ではない。
       */
      if (!next || !canStartLine(next)) {
        break;
      }

      lineIndex++;
      currentMora = 0;
    }
  }

  return null;
}


/* ============================================================
 * 長歌探索
 * ============================================================ */

function findChoka(tokens) {

  /*
   * 長歌:
   *
   * 5-7を3回以上繰り返し、
   * 最後に7を追加。
   *
   * 最短:
   *
   * 5
   * 7
   * 5
   * 7
   * 5
   * 7
   * 7
   *
   * = 終端が 5-7-7
   */

  /*
   * 長い長歌を優先。
   */
  for (let pairs = MAX_CHOKA_PAIRS; pairs >= 3; pairs--) {

    const targets = [];

    for (let i = 0; i < pairs; i++) {
      targets.push(5, 7);
    }

    /*
     * 最後の追加7。
     */
    targets.push(7);

    const result = findPattern(tokens, targets);

    if (result) {
      return result;
    }
  }

  return null;
}


/* ============================================================
 * 全詩形判定
 * ============================================================ */

function detectPoetry(text) {

  /*
   * Yahoo APIは一度しか呼ばない。
   */
  const tokens = addMoraInfo(analyzeUnidic(text));

  /*
   * ★ 必ず長い形式から。
   *
   * 短歌には5-7-5が含まれるため、
   * 川柳を先に探すと短歌が全部
   * 川柳として捕まってしまう。
   */

  /* ---------- 長歌 ---------- */

  const choka = findChoka(tokens);

  if (choka) {
    return {
      found: true,
      type: 'choka',
      name: '長歌',
      poem: choka,
      tokens: tokens
    };
  }

  /* ---------- 短歌 ---------- */

  const tanka = findPattern(tokens, [5, 7, 5, 7, 7]);

  if (tanka) {
    return {
      found: true,
      type: 'tanka',
      name: '短歌',
      poem: tanka,
      tokens: tokens
    };
  }

  /* ---------- 5-7-5 ---------- */

  const poem575 = findPattern(tokens, [5, 7, 5]);

  if (poem575) {
    const kigo = detectKigo(poem575, tokens);

    /*
    * 季語あり → 俳句
    */
    if (kigo) {
      return {
        found: true,
        type: 'haiku',
        name: '俳句',
        poem: poem575,
        kigo: kigo,
        tokens: tokens
      };
    }

    /*
    * 季語なし → 川柳
    */
    return {
      found: true,
      type: 'senryu',
      name: '川柳',
      poem: poem575,
      kigo: null,
      tokens: tokens
    };
  }

  return {
    found: false,
    type: null,
    name: null,
    poem: null,
    tokens: tokens
  };
}


/* ============================================================
 * 季語DB
 * ============================================================ */

/**
 * 最初に一度だけ実行。
 *
 * GitHubの季語DBを取得して、
 * 必要な項目だけに縮めてGoogle Driveへ保存する。
 */
function setupKigoDb() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('KIGO_DB_URL');

  if (!url) {
    throw new Error('スクリプトプロパティ KIGO_DB_URL が設定されていません');
  }

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`季語DB取得失敗: HTTP ${response.getResponseCode()}`);
  }

  const original = JSON.parse(response.getContentText());

  // 判定に必要なものだけ残す
  const compact = original
    .filter(item => item.japanese && item.season)
    .map(item => ({
      word: String(item.japanese).trim(),
      reading: String(item.hiragana || '').trim(),
      season: String(item.season).trim(),
      subSeason: String(item.subSeason || '').trim(),
      category: String(item.category || '').trim()
    }));

  // 長い季語から判定する
  // 「春」より「春の宵」を優先するため
  compact.sort((a, b) => b.word.length - a.word.length);

  const json = JSON.stringify(compact);

  // 保存前に自身で確認
  const verify = JSON.parse(json);

  console.log(`保存予定: ${verify.length}件 / ${json.length}文字`);

  // 古いDBがある場合は更新
  const oldFileId = props.getProperty('KIGO_DB_FILE_ID');

  if (oldFileId) {
    try {
      file.setContent(json);

      // 書き込み後に少し待つ
      Utilities.sleep(500);

      const saved = file.getBlob().getDataAsString('UTF-8');
      const verifySaved = JSON.parse(saved);

      console.log(`季語DB更新完了: ${verifySaved.length}件 / ${saved.length}文字`);

      return;
    } catch (e) {
      console.log('既存季語DBを開けなかったので新規作成します');
    }
  }

  const file = DriveApp.createFile('senryu-kigo-db.json', json, MimeType.PLAIN_TEXT);

  props.setProperty('KIGO_DB_FILE_ID', file.getId());

  console.log(`季語DB作成完了: ${compact.length}件`);
  console.log(`File ID: ${file.getId()}`);
}


/**
 * Driveから季語DBを読む。
 *
 * 5-7-5が成立したときだけ呼ばれるので、
 * 普通のLINEメッセージでは実行されない。
 */
function loadKigoDb() {
  const props = PropertiesService.getScriptProperties();

  const fileId = props.getProperty('KIGO_DB_FILE_ID');

  if (!fileId) {
    throw new Error('季語DBがありません。setupKigoDb() を一度実行してください');
  }

  const file = DriveApp.getFileById(fileId);

  let json = file.getBlob()
    .getDataAsString('UTF-8')
    .trim();

  if (!json) {
    throw new Error('季語DBファイルが空です。setupKigoDb() を再実行してください');
  }

  console.log(`季語DB読み込み: ${json.length}文字`);

  try {
    const db = JSON.parse(json);

    if (!Array.isArray(db)) {
      throw new Error('季語DBのルートが配列ではありません');
    }

    return db;

  } catch (error) {
    console.error(`季語DB JSON破損: length=${json.length}`);
    console.error(`末尾: ${json.slice(-200)}`);

    throw new Error(`季語DBのJSONを読み込めませんでした: ${error.message}`);
  }
}


/* ============================================================
 * 文字正規化
 * ============================================================ */

function toHiragana(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(
      /[\u30a1-\u30f6]/g,
      char => String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
}

function normalizeKigoText(text) {
  return toHiragana(text).replace(/\s/g, '');
}

function normalizeSurface(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s/g, '');
}


/* ============================================================
 * 季語検出
 * ============================================================ */

/**
 * poem:
 * findPattern() が返した
 *
 * {
 *   lines,
 *   readings,
 *   startToken,
 *   endToken
 * }
 *
 * tokens:
 * UniDicの解析結果
 */
function detectKigo(poem, tokens) {
  const db = loadKigoDb();

  const poemTokens = tokens.slice(poem.startToken, poem.endToken + 1);
  const spans = buildKigoSpans(poemTokens);

  /*
   * 同じ読みを持つ季語が複数ある場合、
   * 読みだけでは特定不能なので候補から外す。
   *
   * 例:
   * 「かき」→ 柿 / 牡蛎 など
   */
  const readingCounts = new Map();

  for (const kigo of db) {
    const reading = normalizeKigoText(kigo.reading);

    if (!reading) continue;

    readingCounts.set(reading, (readingCounts.get(reading) || 0) + 1);
  }

  const matches = [];

  for (const kigo of db) {
    const word = normalizeSurface(kigo.word);
    const kigoReading = normalizeKigoText(kigo.reading);

    for (const span of spans) {

      /*
       * 最優先:
       * 表記そのものが完全一致
       *
       * 「蛙」 == 「蛙」
       * 「春の宵」 == 「春の宵」
       */
      if (word && span.surface === word) {
        matches.push({
          ...kigo,
          matchType: 'surface',
          matchedText: span.original
        });

        break;
      }

      /*
       * 読み一致は補助。
       *
       * 実際の表記が全部かなの場合のみ。
       *
       * 「かえる」→「蛙」は許す。
       *
       * 「垣」→「牡蛎」は許さない。
       */
      if (
        kigoReading &&
        span.kanaOnly &&
        span.reading === kigoReading &&
        readingCounts.get(kigoReading) === 1
      ) {
        matches.push({
          ...kigo,
          matchType: 'reading',
          matchedText: span.original
        });

        break;
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  /*
   * 表記一致を最優先。
   * 同じなら長い季語を優先。
   */
  matches.sort((a, b) => {
    if (a.matchType !== b.matchType) {
      return a.matchType === 'surface' ? -1 : 1;
    }

    return [...b.word].length - [...a.word].length;
  });

  return {
    primary: matches[0],
    matches
  };
}


/**
 * 季語候補となる連続トークンを生成。
 *
 * 例:
 *
 * 春 / の / 宵
 *
 * ↓
 *
 * 春
 * 春の
 * 春の宵
 * の
 * の宵
 * 宵
 */
function buildKigoSpans(tokens) {
  const spans = [];

  /*
   * 季語が10形態素を超えるケースまで
   * 探す必要はまずない。
   */
  const MAX_TOKENS = 8;

  for (let start = 0; start < tokens.length; start++) {

    let surface = '';
    let reading = '';
    let original = '';

    for (
      let end = start;
      end < tokens.length && end < start + MAX_TOKENS;
      end++
    ) {
      const token = tokens[end];

      surface += normalizeSurface(token.surface);
      reading += normalizeKigoText(token.reading);
      original += token.surface || '';

      /*
       * 実際の表記がかなだけか。
       *
       * 読み一致による季語認定は
       * この場合だけ許す。
       */
      const kanaOnly = /^[ぁ-ゖァ-ヺー]+$/.test(surface);

      spans.push({
        surface,
        reading,
        original,
        kanaOnly,
        start,
        end
      });
    }
  }

  return spans;
}


/* ============================================================
 * 季節表示
 * ============================================================ */

function getSeasonInfo(season) {
  switch (season) {
    case 'spring':
      return { ja: '春', emoji: '🌸' };

    case 'summer':
      return { ja: '夏', emoji: '🌻' };

    case 'autumn':
      return { ja: '秋', emoji: '🍁' };

    case 'winter':
      return { ja: '冬', emoji: '❄️' };

    case 'new year':
      return { ja: '新年', emoji: '🎍' };

    default:
      return { ja: season, emoji: '🦭' };
  }
}


/* ============================================================
 * LINEなしテスト
 * ============================================================ */

/*
 * 1文を詳しくテストしたいとき。
 *
 * ここを書き換えて実行すればOK。
 */
function testOne() {
  debugPoetry('柿食えば鐘が鳴るなり法隆寺');
}

/*
 * 複数文テスト。
 */
function testPoetry() {
  const cases = [
    '古池や蛙飛び込む水の音',
    '柿食えば鐘が鳴るなり法隆寺',
    'これは普通の文章なので川柳ではないと思います',
    '今日はねとっても楽しい一日だ',
    'ちなみに古池や蛙飛び込む水の音って有名だよね',
    'そういえばアニメーションはおもろいが'
  ];

  for (const text of cases) {
    try {
      const result = detectPoetry(text);

      console.log('================================');
      console.log(`入力: ${text}`);

      if (!result.found) {
        console.log('❌ 検出なし');
        continue;
      }

      console.log(`✅ ${result.name}`);
      console.log(result.poem.lines.join(' / '));
      console.log(result.poem.readings.join(' / '));

    } catch (error) {
      console.error(`ERROR: ${text}\n` + (error.stack || error));
    }
  }
}

/*
 * 形態素解析まで含めて
 * 詳細表示。
 */
function debugPoetry(text) {
  const result = detectPoetry(text);

  console.log('================================');
  console.log(`入力: ${text}`);
  console.log('--------------------------------');

  for (const token of result.tokens) {
    console.log(
      `${token.surface}` +
      ` / ${token.reading}` +
      ` / ${token.pos}` +
      ` / ${token.posDetail}` +
      ` / ${token.conjugationForm}` +
      ` / ${token.mora}拍`
    );
  }

  console.log('--------------------------------');

  if (!result.found) {
    console.log('❌ 詩形なし');
    return result;
  }

  console.log(`🦭 ${result.name}検出！`);

  for (let i = 0; i < result.poem.lines.length; i++) {
    console.log(
      `${result.poem.lines[i]}` +
      ` / ` +
      `${result.poem.readings[i]}` +
      ` / ` +
      `${result.poem.mora[i]}拍`
    );
  }

  console.log('--------------------------------');
  console.log(createPoetryReply(result));

  return result;
}


/* ============================================================
 * Yahoo UniDic API単体テスト
 * ============================================================ */

function testUnidic() {
  const text = '古池や蛙飛び込む水の音';

  const tokens = addMoraInfo(analyzeUnidic(text));

  for (const token of tokens) {
    console.log(
      `${token.surface}` +
      ` | 読み=${token.reading}` +
      ` | 品詞=${token.pos}` +
      ` | 詳細=${token.posDetail}` +
      ` | 活用形=${token.conjugationForm}` +
      ` | ${token.mora}拍`
    );
  }
}

function testKigo() {
  const cases = [
    '古池や蛙飛び込む水の音',
    'お前らがめんどいせいで判定が',
    '夏の夜に何かが起きる気がします'
  ];

  for (const text of cases) {
    const result = detectPoetry(text);

    console.log('====================');
    console.log(text);

    if (!result.found) {
      console.log('検出なし');
      continue;
    }

    console.log(`${result.name}: ` + result.poem.lines.join(' / '));

    if (result.kigo) {
      console.log(`季語: ${result.kigo.primary.word}`);
      console.log(`季節: ${result.kigo.primary.season}`);
      console.log('候補: ' + result.kigo.matches.map(k => k.word).join(', '));
    }
  }
}

function testKigoDbFile() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('KIGO_DB_FILE_ID');

  console.log(`fileId = ${fileId}`);

  const file = DriveApp.getFileById(fileId);
  const json = file.getBlob().getDataAsString('UTF-8');

  console.log(`文字数 = ${json.length}`);
  console.log(`先頭100文字 = ${json.slice(0, 100)}`);
  console.log(`末尾100文字 = ${json.slice(-100)}`);

  const db = JSON.parse(json);

  console.log(`JSON OK: ${db.length}件`);
}
