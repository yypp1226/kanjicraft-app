const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const ROOT_DIR = __dirname;

// 예외 발생 시 서버 강제 종료 방지
process.on('uncaughtException', (err) => {
  console.error('⚠️ 예기치 않은 오류 발생:', err.message);
});

app.use(cors());
app.use(express.json());

console.log('📁 서버 실행 경로:', ROOT_DIR);

// 1. 화면(HTML) 라우트 설정
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// 2. 정적 파일 서비스
app.use(express.static(ROOT_DIR));

// 3. SQLite DB 연결
const dbPath = path.join(ROOT_DIR, 'kanji_app.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ DB 연결 실패:', err.message);
  else console.log('✅ SQLite DB(kanji_app.db) 연결 성공!');
});

// 4. DB 테이블 생성
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT NOT NULL,
      user_current_grade TEXT DEFAULT '초1',
      daily_goal INTEGER DEFAULT 3,
      gold_medals INTEGER DEFAULT 0,
      today_learned_list TEXT DEFAULT '[]',
      wrong_list TEXT DEFAULT '[]',
      custom_kanji_list TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 5. 한자 데이터베이스 로드
const jsonPath = path.join(ROOT_DIR, 'jis_kanji_master_db.json');
let kanjiMasterMap = {};
if (fs.existsSync(jsonPath)) {
  try {
    kanjiMasterMap = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`✅ 한자 마스터 DB 로드 완료 (${Object.keys(kanjiMasterMap).length}자 수록)`);
  } catch (e) {
    console.warn('⚠️ json 파일 파싱 실패:', e.message);
  }
}

app.get('/api/kanji-all', (req, res) => {
  const data = Object.values(kanjiMasterMap).map((item, idx) => ({
    id: idx + 1,
    char: item.char,
    schoolLevel: item.schoolLevel || '고난도',
    jlpt: item.jlpt || null,
    strokes: item.strokes || '',
    koreanMean: item.koreanMean || '뜻 직접입력',
    koreanSound: item.koreanSound || '',
    onyomi: item.onyomi || [],
    kunyomi: item.kunyomi || [],
    formula: item.formula || '',
    quizContext: `「${item.char}」 단어 예문`,
    wrongCount: 0,
    mastered: false
  }));
  res.json({ success: true, data });
});

app.get('/api/kanji/:char', (req, res) => {
  const char = decodeURIComponent(req.params.char);
  const found = kanjiMasterMap[char];
  if (found) res.json({ success: true, ...found });
  else res.status(404).json({ success: false, message: '한자를 찾을 수 없습니다.' });
});

// 6. 회원가입 API
app.post('/api/auth/register', async (req, res) => {
  const { email, password, nickname } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail) || !password || !nickname) {
    return res.status(400).json({ success: false, message: '올바른 이메일과 정보를 입력해주세요.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)`;
    
    db.run(sql, [cleanEmail, hashedPassword, nickname], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.json({ success: false, message: '이미 가입된 이메일 주소입니다.' });
        }
        return res.json({ success: false, message: '회원가입 처리 중 오류가 발생했습니다.' });
      }

      return res.json({
        success: true,
        user: {
          email: cleanEmail,
          nickname: nickname,
          userCurrentGrade: '초1',
          dailyGoal: 3,
          goldMedals: 0,
          todayLearnedList: [],
          customKanjiList: []
        }
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
  }
});

// 7. 로그인 API
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  const sql = `SELECT * FROM users WHERE email = ?`;
  db.get(sql, [cleanEmail], async (err, user) => {
    if (err) return res.json({ success: false, message: '로그인 오류가 발생했습니다.' });
    if (!user) return res.json({ success: false, message: '가입되지 않은 이메일 주소입니다.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: '비밀번호가 일치하지 않습니다.' });

    return res.json({
      success: true,
      user: {
        email: user.email,
        nickname: user.nickname,
        userCurrentGrade: user.user_current_grade,
        dailyGoal: user.daily_goal,
        goldMedals: user.gold_medals,
        todayLearnedList: JSON.parse(user.today_learned_list || '[]'),
        customKanjiList: JSON.parse(user.custom_kanji_list || '[]')
      }
    });
  });
});

// 8. 동기화 API
app.post('/api/user/sync', (req, res) => {
  const { email, userCurrentGrade, dailyGoal, todayLearnedList, goldMedals, customKanjiList, wrongList } = req.body;
  if (!email) return res.json({ success: false, message: '이메일 정보가 누락되었습니다.' });

  const sql = `
    UPDATE users 
    SET user_current_grade = ?, daily_goal = ?, gold_medals = ?, 
        today_learned_list = ?, custom_kanji_list = ?, wrong_list = ?
    WHERE email = ?
  `;

  const params = [
    userCurrentGrade,
    dailyGoal,
    goldMedals,
    JSON.stringify(todayLearnedList || []),
    JSON.stringify(customKanjiList || []),
    JSON.stringify(wrongList || []),
    email.trim().toLowerCase()
  ];

  db.run(sql, params, function (err) {
    if (err) return res.json({ success: false, message: '동기화 실패' });
    return res.json({ success: true, message: '동기화 완료' });
  });
});

// 9. 서버 실행 및 유지
const server = app.listen(PORT, () => {
  console.log(`🚀 KanjiCraft 백엔드 서버 실행 완료: http://localhost:${PORT}`);
  console.log('📌 서버가 정상 유지 중입니다 (종료하려면 Ctrl + C 입력)');
});

// 프로세스가 꺼지지 않도록 이벤트 루프 유지
setInterval(() => {}, 1000 * 60 * 60);