/**
 * 조준경 (youtubeScope) AI 유사도 및 2차 정밀 분석 벤치마크 (v7.0)
 */

const { evaluateVideoIntent } = require("./similarity-engine.js");

const TEST_DATASET = [
  // --- [물리학 / 과학 시나리오 (삼체 문제 케이스 포함)] ---
  {
    goal: "물리",
    title: "천재 물리학자도 포기?! 300년째 풀리지 않는 삼체 문제 (feat. 넷플릭스 삼체)",
    description: "뉴턴도 포기한 삼체 문제와 카오스 이론, 라그랑주 점과 제임스 웹 우주망원경 이야기",
    keywords: "물리, 물리학, 삼체문제, 카오스이론, 우주",
    channel: "세모과학",
    aiSummary: "00:00 삼체 문제란? 04:20 뉴턴 운동 방정식과 카오스 이론 09:15 라그랑주 점과 인류의 해법",
    expected: true,
    category: "물리학 삼체문제 강좌"
  },
  {
    goal: "자료구조 해시테이블 공부",
    title: "해시테이블 개념과 구현 - 자료구조 강의 8강",
    description: "해시함수와 충돌 해결 기법(Chaining, Open Addressing)을 C++로 구현합니다.",
    keywords: "자료구조, 해시테이블, 코딩테스트, C++",
    channel: "쉬운코드",
    aiSummary: "00:00 해시테이블 개념 03:15 해시 함수와 충돌 해결 08:30 C++ 구현 실습",
    expected: true,
    category: "직접 연관 강좌"
  },
  {
    goal: "자료구조 해시테이블 공부",
    title: "Hash Table Data Structure in 10 Minutes",
    description: "Learn how hash maps work under the hood with code examples.",
    keywords: "data structure, hash table, hashmap, algorithm",
    channel: "freeCodeCamp.org",
    aiSummary: "00:00 Introduction 02:10 Hash Functions 06:40 Handling Collisions with Chaining",
    expected: true,
    category: "영문 기술 영상"
  },
  {
    goal: "SQL 공부",
    title: "SQL 조인(JOIN) 종류 완벽 정리 (INNER, LEFT, RIGHT)",
    description: "관계형 데이터베이스 핵심인 JOIN 문법을 10분 만에 정복하세요.",
    keywords: "SQL, Database, MySQL, JOIN",
    channel: "개발자 김코딩",
    aiSummary: "00:00 RDBMS 조인 개념 04:00 INNER JOIN vs LEFT JOIN 08:00 실전 쿼리 예제",
    expected: true,
    category: "직접 연관 강좌"
  },
  {
    goal: "SQL 공부",
    title: "데이터베이스 인덱스(Index) 튜닝과 성능 최적화",
    description: "B-Tree 인덱스의 원리와 쿼리 속도 개선 기법",
    keywords: "Database, Index, SQL, Query",
    channel: "백엔드 아카데미",
    aiSummary: "00:00 B-Tree 인덱스 구조 05:20 클러스터드 vs 논클러스터드 인덱스 12:00 SQL 튜닝 사례",
    expected: true,
    category: "파생 심화 주제"
  },
  {
    goal: "React 공부",
    title: "React 19 신기능 살펴보기 & Use Action Hook 튜토리얼",
    description: "리액트 19 변경사항과 실전 프로젝트 활용법",
    keywords: "React, Next.js, Frontend, JavaScript",
    channel: "드림코딩",
    aiSummary: "00:00 React 19 패치노트 03:30 useActionState Hook 활용 10:00 Server Components",
    expected: true,
    category: "영한 혼용 기술"
  },
  {
    goal: "알고리즘 코딩테스트 준비",
    title: "백준 14502 연구소 - DFS/BFS 문제 풀이 (파이썬)",
    description: "삼성 기출 문제 풀이 및 시간복잡도 분석",
    keywords: "알고리즘, 코딩테스트, 백준, 파이썬",
    channel: "바킹독의 실전 알고리즘",
    aiSummary: "00:00 문제 분석 03:00 벽 3개 세우기 (조합) 07:00 BFS 바이러스 퍼뜨리기",
    expected: true,
    category: "코테 풀이"
  },
  {
    goal: "파이썬 데이터 분석",
    title: "Pandas 기초 30분 만에 끝내기 - 데이터프레임 조작",
    description: "파이썬 데이터 분석 입문자를 위한 필수 라이브러리",
    keywords: "파이썬, Pandas, 데이터분석",
    channel: "테디노트",
    aiSummary: "00:00 DataFrame 생성 10:00 read_csv 데이터 불러오기 20:00 groupby 전처리",
    expected: true,
    category: "직접 연관 강좌"
  },
  {
    goal: "토익 영단어 암기",
    title: "TOEIC 900점 완성 필수 고득점 어휘 100선 반복 듣기",
    description: "토익 기출 어휘 예문과 함께 암기하기",
    keywords: "토익, 영단어, 영어공부, 보카",
    channel: "해커스 토익",
    aiSummary: "00:00 Part 5 핵심 어휘 1-50 15:00 Part 7 패러프레이징 단어",
    expected: true,
    category: "비개발 공부"
  },
  {
    goal: "이력서 및 개발자 면접 준비",
    title: "네카라쿠배 프론트엔드 합격자 포트폴리오 분석 및 면접 질문 모음",
    description: "신입 개발자 합격 팁과 기술 면접 대비",
    keywords: "개발자, 면접, 포트폴리오, 취업",
    channel: "노마드 코더 Nomad Coders",
    aiSummary: "00:00 합격 자소서 특징 05:00 포트폴리오 구조 12:00 기술 면접 단골 질문",
    expected: true,
    category: "취업/면접 준비"
  },

  // --- [오락/딴짓] ---
  {
    goal: "자료구조 해시테이블 공부",
    title: "50만원 미만 사무용 의자 추천 Best4 (허먼밀러 시디즈)",
    description: "개발자를 위한 가성비 의자 비교 리뷰",
    keywords: "의자, 쇼핑, 의자추천",
    channel: "귀곰",
    aiSummary: "00:00 허먼밀러 리뷰 04:00 시디즈 T50 착좌감 08:00 가성비 1위 추천",
    expected: false,
    category: "쇼핑/장비 리뷰"
  },
  {
    goal: "자료구조 해시테이블 공부",
    title: "Pretty Girl - RESCENE(리센느) Official MV",
    description: "RESCENE 1st Mini Album [Scenedrome]",
    keywords: "KPOP, MV, RESCENE",
    channel: "Mnet K-POP",
    aiSummary: "00:00 RESCENE Pretty Girl Music Video",
    expected: false,
    category: "음악/아이돌 MV"
  },
  {
    goal: "자료구조 해시테이블 공부",
    title: "아이돌 안무가 마이클 유 MASTER CLASS 직캠",
    description: "K-pop 댄스 클래스 하이라이트",
    keywords: "Dance, Kpop, 댄스",
    channel: "1MILLION Dance Studio",
    aiSummary: "00:00 Intro 01:20 1절 안무 시범 03:50 수강생 수료 무대",
    expected: false,
    category: "오락/댄스"
  },
  {
    goal: "SQL 공부",
    title: "오늘 브이로그: 성수동 예쁜 카페 투어 & 데일리룩",
    description: "주말 일상 브이로그입니다.",
    keywords: "브이로그, 성수동, 카페투어",
    channel: "일상 브이로그 CH",
    aiSummary: "00:00 준비하기 03:00 성수동 카페 07:00 옷 쇼핑 하울",
    expected: false,
    category: "일상 브이로그"
  },
  {
    goal: "파이썬 코딩 공부",
    title: "개발자의 M3 맥북 프로 언박싱 & 하루 브이로그",
    description: "새로 산 맥북 세팅하기와 출근길 일상",
    keywords: "맥북, 언박싱, 개발자 브이로그",
    channel: "개발자 일상",
    aiSummary: "00:00 맥북 언박싱 04:00 데스크테리어 08:00 카페 작업",
    expected: false,
    category: "장비 브이로그"
  },
  {
    goal: "알고리즘 문제풀이 코테 준비",
    title: "롤(LoL) 페이커 전설의 페이커 플레이 명장면 하이라이트",
    description: "2026 롤드컵 매드무비 모음집",
    keywords: "롤, 페이커, 게임하이라이트",
    channel: "T1 LoL",
    aiSummary: "00:00 르블랑 슈퍼플레이 03:00 아지르 토스 07:00 펜타킬",
    expected: false,
    category: "게임/하이라이트"
  },
  {
    goal: "알고리즘 문제풀이 코테 준비",
    title: "개발자가 겪는 멘붕 모음집 (웃긴 유머 밈)",
    description: "코딩하다 버그 났을 때 개발자 반응 ㅋㅋㅋ",
    keywords: "유머, 밈, 개발자밈",
    channel: "웃긴영상 모음",
    aiSummary: "00:00 버그 수정 02:00 서버 다운 05:00 퇴사 짤 모음",
    expected: false,
    category: "유머/밈"
  },
  {
    goal: "토익 영단어 암기",
    title: "오사카 도톤보리 라멘 맛집 탐방 먹방 브이로그",
    description: "일본 여행 3일차 먹방 스페셜",
    keywords: "먹방, 일본여행, 오사카",
    channel: "먹방러 TV",
    aiSummary: "00:00 도톤보리 도착 03:00 이치란 라멘 07:00 타코야키",
    expected: false,
    category: "여행/먹방"
  },
  {
    goal: "스프링 백엔드 공부",
    title: "손흥민 골 모음집 - 프리미어리그 하이라이트",
    description: "토트넘 홋스퍼 역대급 골 장면",
    keywords: "손흥민, 축구, 하이라이트",
    channel: "SPOTV",
    aiSummary: "00:00 푸스카스상 원더골 03:00 해트트릭 06:00 슈팅 하이라이트",
    expected: false,
    category: "스포츠"
  },
  {
    goal: "React 공부",
    title: "주식 초보자를 위한 2026년 반도체 대장주 분석",
    description: "삼성전자 SK하이닉스 주가 전망",
    keywords: "주식, 반도체, 삼성전자",
    channel: "삼프로TV",
    aiSummary: "00:00 반도체 업황 전망 05:00 HBM 수혜주 12:00 매수 타이밍",
    expected: false,
    category: "재테크/주식"
  },
  {
    goal: "자료구조 공부",
    title: "자료구조 공부 1도 안 하고 코테 합격하는 비법 ㅋㅋㅋ",
    description: "어그로 죄송합니다 롤 챔피언 티어 정리 영상입니다",
    keywords: "롤, 티어정리, 코테",
    channel: "롤 예능 TV",
    aiSummary: "00:00 어그로 해명 01:00 롤 미드 티어표 05:00 챔피언 추천",
    expected: false,
    category: "어그로/클릭베이트"
  },
  {
    goal: "파이썬 기초",
    title: "파이썬으로 마인크래프트 게임 만들다 멘탈 나감",
    description: "게임 플레이 위주의 예능 방송",
    keywords: "마인크래프트, 게임방송",
    channel: "게임 스트리머",
    aiSummary: "00:00 마인크래프트 실행 03:00 건축 예능 08:00 멀티플레이",
    expected: false,
    category: "예능형 게임"
  },
  {
    goal: "C++ 언어 공부",
    title: "C++ 개발자의 자취방 청소 & 배달음식 먹방",
    description: "자취 일상 이야기",
    keywords: "먹방, 브이로그, 자취",
    channel: "자취 일기",
    aiSummary: "00:00 방 청소하기 03:00 마라탕 먹방 07:00 넷플릭스 시청",
    expected: false,
    category: "일상 먹방"
  },
  {
    goal: "알고리즘 공부",
    title: "유튜브 알고리즘의 선택을 받는 10가지 방법",
    description: "유튜브 채널 떡상하는 꿀팁 노하우",
    keywords: "유튜브 알고리즘, 채널성장",
    channel: "유튜브 크리에이터 랩",
    aiSummary: "00:00 시청 지속 시간 늘리기 04:00 클릭률(CTR) 썸네일 노하우",
    expected: false,
    category: "단어 혼동 (유튜브 알고리즘)"
  },
  {
    goal: "웹 개발 공부",
    title: "웹소설 작가의 하루 수입 공개 (웹소설 지망생 필수 시청)",
    description: "웹소설 집필 팁",
    keywords: "웹소설, 수입공개",
    channel: "웹소설 작가 TV",
    aiSummary: "00:00 웹소설 월 정산 04:00 카카오페이지 유입 분석",
    expected: false,
    category: "단어 혼동 (웹소설 vs 웹개발)"
  }
];

function runAccuracyTest() {
  console.log("==========================================================================================");
  console.log("🎯 조준경 개편된 AI(물리학/삼체문제 케이스 검증) 벤치마크 테스트 (v7.0)");
  console.log("==========================================================================================\n");

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let totalLatency = 0;
  const results = [];

  for (let i = 0; i < TEST_DATASET.length; i++) {
    const item = TEST_DATASET[i];
    
    const startTime = performance.now();
    const verdict = evaluateVideoIntent(item.goal, item.title, item.description, item.keywords, item.channel, item.aiSummary);
    const endTime = performance.now();
    const latency = endTime - startTime;
    totalLatency += latency;

    const isMatch = verdict.related === item.expected;

    if (item.expected && verdict.related) tp++;
    if (!item.expected && verdict.related) fp++;
    if (!item.expected && !verdict.related) tn++;
    if (item.expected && !verdict.related) fn++;

    results.push({
      id: i + 1,
      goal: item.goal,
      title: item.title,
      channel: item.channel,
      description: item.description,
      aiSummary: item.aiSummary,
      sourcesUsed: verdict.sourcesUsed,
      expected: item.expected,
      predicted: verdict.related,
      score: verdict.score,
      isMatch,
      latency: latency.toFixed(3),
      category: item.category
    });
  }

  const total = TEST_DATASET.length;
  const accuracy = ((tp + tn) / total) * 100;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const avgLatency = totalLatency / total;

  console.log("📋 [개편된 AI 검증결과 - 물리/삼체문제 케이스 포함]");
  console.log("--------------------------------------------------------------------------------------------------");
  console.log(`| #  | 상태 | 예측 (점수) | 실제 | 카테고리          | 채널 & 영상 제목`);
  console.log("--------------------------------------------------------------------------------------------------");
  
  for (const res of results) {
    const statusIcon = res.isMatch ? "✅ PASS" : "❌ FAIL";
    const predStr = res.predicted ? `TRUE  (${res.score})` : `FALSE (${res.score})`;
    const expStr = res.expected ? "TRUE " : "FALSE";
    const titleTrunc = res.title.length > 28 ? res.title.substring(0, 25) + "..." : res.title.padEnd(28);
    const channelTrunc = res.channel.length > 8 ? res.channel.substring(0, 6) + ".." : res.channel.padEnd(8);

    console.log(`| ${String(res.id).padStart(2)} | ${statusIcon} | ${predStr.padEnd(11)} | ${expStr} | ${res.category.padEnd(14)} | [${channelTrunc}] ${titleTrunc}`);
  }

  console.log("--------------------------------------------------------------------------------------------------\n");

  console.log("📊 [종합 개편 AI 평가 리포트]");
  console.log(`• 총 테스트 케이스: ${total}개`);
  console.log(`• 정확도 (Accuracy)   : ${accuracy.toFixed(1)}% (${tp + tn}/${total})`);
  console.log(`• 정밀도 (Precision)  : ${precision.toFixed(1)}%`);
  console.log(`• 재현율 (Recall)     : ${recall.toFixed(1)}%`);
  console.log(`• 삼체 문제(물리) 케이스 : ${results[0].isMatch ? '✅ 통과 (점수: ' + results[0].score + ')' : '❌ 실패'}`);
  console.log(`• 평균 연산 시간      : ${avgLatency.toFixed(3)} ms`);
  console.log("==========================================================================================\n");
}

runAccuracyTest();
