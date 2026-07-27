/**
 * 조준경 (youtubeScope) 범용 AI 텍스트 유사도 엔진 (v8.1)
 * 
 * 주요 개편 사항:
 * 1. 어근(Stemming) 일치 및 단어 포함 비율 (Containment Ratio) 가중치 도입 (문장 길이에 따른 점수 희석 완전 방지)
 * 2. 설명란(Description) 및 해시태그(#물리학 등) 가중치 대폭 강화 (2.5x)
 * 3. 유튜브 DOM 실시간 메타데이터 추출 교차 반영
 */

const CONTEXT_DISAMBIGUATION = [
  {
    goalPattern: /알고리즘|코딩테스트/i,
    negativeVideoPattern: /유튜브\s*알고리즘|채널\s*떡상|조회수|구독자|알고리즘의\s*선택/i,
    penalty: 0.05
  },
  {
    goalPattern: /웹\s*개발|프론트엔드|백엔드/i,
    negativeVideoPattern: /웹소설|웹툰|작가|수입\s*공개/i,
    penalty: 0.05
  },
  {
    goalPattern: /자료구조|알고리즘|공부|학습/i,
    negativeVideoPattern: /1도\s*안\s*하고|어그로|꿀잼|밈\s*모음|멘붕\s*모음/i,
    penalty: 0.1
  }
];

const EDU_CHANNEL_PATTERNS = /강의|학습|교육|인강|공부|튜토리얼|개발자|코딩|노마드|생활코딩|드림코딩|쉬운코드|백준|프로그래머스|세모과학|안될과학|과학쿠키|1분과학|사피엔스|coding|tutorial|academy|edu|tech|course|science/i;

const ENTERTAINMENT_KEYWORD_PATTERNS = [
  /브이로그|vlog/i,
  /먹방|mukbang/i,
  /아이돌|걸그룹|보이그룹|mv|뮤비|음중|인기가요|직캠/i,
  /하이라이트|게임|명장면|플레이|gameplay|stream/i,
  /언박싱|unboxing|하울|쇼핑/i,
  /개그|웃긴|역대급|반전/i,
  /웹예능|예능|릴스|reels|shorts|쇼츠/i,
  /의자|책상|룸투어|자취/i
];

const STOP_WORDS = new Set([
  "오늘", "영상", "유튜브", "시청", "보기", "추천", "모음", "최신", "관한", "대한",
  "있습니다", "합니다", "입니다", "이것", "저것", "무엇", "어떻게", "진짜", "대박",
  "best", "top", "vlog", "video", "youtube", "watch", "how", "to", "the", "and", "or",
  "준비", "공부", "학습", "하기", "기초", "채널", "요약"
]);

function tokenizeAndExpand(text) {
  if (!text || typeof text !== "string") return [];
  
  const cleanText = text.toLowerCase().replace(/[^a-zA-Z0-9가-힣\s]/g, " ");
  const rawWords = cleanText.split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
  
  const tokens = [];
  for (const word of rawWords) {
    tokens.push(word);
    
    // 한글 단어 N-gram 분해 (어미/조사 차이 일반화)
    if (/[가-힣]/.test(word) && word.length >= 2) {
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.substring(i, i + 2));
      }
    }
  }
  
  return tokens;
}

function createTfMap(tokens, weight = 1.0) {
  const tfMap = new Map();
  for (const token of tokens) {
    tfMap.set(token, (tfMap.get(token) || 0) + weight);
  }
  return tfMap;
}

function computeCosineSimilarity(tfMapA, tfMapB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  
  for (const val of tfMapA.values()) {
    normA += val * val;
  }
  for (const val of tfMapB.values()) {
    normB += val * val;
  }
  
  if (normA === 0 || normB === 0) return 0.0;
  
  for (const [token, valA] of tfMapA.entries()) {
    if (tfMapB.has(token)) {
      dotProduct += valA * tfMapB.get(token);
    }
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeContainmentRatio(goalTokens, videoTokens) {
  if (!goalTokens || goalTokens.length === 0) return 0;
  
  const videoTokenSet = new Set(videoTokens);
  let matchedCount = 0;

  for (const gToken of goalTokens) {
    let matched = false;
    for (const vToken of videoTokenSet) {
      if (vToken.includes(gToken) || gToken.includes(vToken)) {
        matched = true;
        break;
      }
    }
    if (matched) matchedCount++;
  }

  return matchedCount / goalTokens.length;
}

function calculateFastSimilarity(purpose, title, description = "", keywords = "", channel = "", aiSummary = "") {
  if (!purpose || !title) {
    return { score: 0, isEntertainmentPenalty: false, isDisambiguated: false, sourcesUsed: [] };
  }

  const sourcesUsed = ["title"];

  const goalTokens = tokenizeAndExpand(purpose);
  const titleTokens = tokenizeAndExpand(title);
  
  const videoTf = createTfMap(titleTokens, 3.0);
  const allVideoTokens = [...titleTokens];

  if (aiSummary) {
    sourcesUsed.push("aiSummary");
    const aiTokens = tokenizeAndExpand(aiSummary.slice(0, 1000));
    allVideoTokens.push(...aiTokens);
    const aiTf = createTfMap(aiTokens, 3.5);
    for (const [token, count] of aiTf.entries()) {
      videoTf.set(token, (videoTf.get(token) || 0) + count);
    }
  }

  if (channel) {
    sourcesUsed.push("channel");
    const channelTokens = tokenizeAndExpand(channel);
    allVideoTokens.push(...channelTokens);
    const channelTf = createTfMap(channelTokens, 2.5);
    for (const [token, count] of channelTf.entries()) {
      videoTf.set(token, (videoTf.get(token) || 0) + count);
    }
  }

  if (keywords) {
    sourcesUsed.push("keywords");
    const keywordTokens = tokenizeAndExpand(keywords);
    allVideoTokens.push(...keywordTokens);
    const keywordTf = createTfMap(keywordTokens, 2.5);
    for (const [token, count] of keywordTf.entries()) {
      videoTf.set(token, (videoTf.get(token) || 0) + count);
    }
  }

  if (description) {
    sourcesUsed.push("description");
    const descTokens = tokenizeAndExpand(description.slice(0, 1500));
    allVideoTokens.push(...descTokens);
    const descTf = createTfMap(descTokens, 2.5);
    for (const [token, count] of descTf.entries()) {
      videoTf.set(token, (videoTf.get(token) || 0) + count);
    }
  }

  const goalTf = createTfMap(goalTokens, 1.0);

  const cosineScore = computeCosineSimilarity(goalTf, videoTf);
  const containmentRatio = computeContainmentRatio(goalTokens, allVideoTokens);

  let rawScore = (cosineScore * 0.4) + (containmentRatio * 0.6);

  let isDisambiguated = false;
  for (const rule of CONTEXT_DISAMBIGUATION) {
    if (rule.goalPattern.test(purpose) && (rule.negativeVideoPattern.test(title) || rule.negativeVideoPattern.test(aiSummary))) {
      rawScore *= rule.penalty;
      isDisambiguated = true;
    }
  }

  let isEntertainmentPenalty = false;
  const isVlogOrMukbang = /브이로그|vlog|언박싱|unboxing|먹방|mukbang/i.test(title);
  const isEntertainmentTarget = ENTERTAINMENT_KEYWORD_PATTERNS.some(pattern => pattern.test(title));
  
  if (isVlogOrMukbang || isEntertainmentTarget) {
    isEntertainmentPenalty = true;
    rawScore *= 0.15;
  }

  const finalScore = Math.min(1.0, Math.max(0.0, rawScore));

  return {
    score: Number(finalScore.toFixed(4)),
    isEntertainmentPenalty,
    isDisambiguated,
    sourcesUsed
  };
}

function evaluateVideoIntent(purpose, title, description = "", keywords = "", channel = "", aiSummary = "", options = {}) {
  const highThreshold = options.highThreshold ?? 0.15;
  const lowThreshold = options.lowThreshold ?? 0.05;
  
  const { score, isEntertainmentPenalty, isDisambiguated, sourcesUsed } = calculateFastSimilarity(purpose, title, description, keywords, channel, aiSummary);

  let related = false;
  let confidence = "HIGH";
  let status = "DECIDED";
  let reason = "";

  if (isDisambiguated || (isEntertainmentPenalty && score < highThreshold)) {
    related = false;
    confidence = "HIGH";
    reason = "공부 목적과 무관한 오락/어그로/딴짓 콘텐츠입니다.";
  } else if (score >= highThreshold) {
    related = true;
    confidence = "HIGH";
    reason = `목표와 유사도(${Math.round(score * 100)}%)가 높습니다. [분석 소스: ${sourcesUsed.join(", ")}]`;
  } else if (score < lowThreshold) {
    related = false;
    confidence = "HIGH";
    reason = `목표와의 연관성(${Math.round(score * 100)}%)이 없습니다.`;
  } else {
    related = score >= 0.08;
    confidence = "MEDIUM";
    status = "AMBIGUOUS";
    reason = `연관성 경계선(${Math.round(score * 100)}%)에 위치해 있습니다.`;
  }

  return {
    related,
    score,
    confidence,
    status,
    reason,
    sourcesUsed,
    method: "UNIVERSAL_FIVE_DIMENSIONAL_AI_V8.1"
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    tokenizeAndExpand,
    calculateFastSimilarity,
    evaluateVideoIntent
  };
}
