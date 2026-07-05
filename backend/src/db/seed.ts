import 'dotenv/config';
import { pool } from '../config/db';

const questions = [
  // umumiy_bilim
  { category: 'umumiy_bilim', text: "Dunyodagi eng katta okean qaysi?", options: ["Atlantika", "Tinch okeani", "Hind okeani", "Shimoliy Muz okeani"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Inson tanasida nechta suyak bor (kattalarda)?", options: ["186", "206", "226", "246"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Yer kurrasining necha foizini suv egallaydi?", options: ["51%", "61%", "71%", "81%"], correctIndex: 2 },
  { category: 'umumiy_bilim', text: "Qaysi sayyora \"Qizil sayyora\" deb ataladi?", options: ["Venera", "Mars", "Yupiter", "Saturn"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Dunyodagi eng baland tog' cho'qqisi?", options: ["K2", "Everest", "Kilimanjaro", "Elbrus"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Fotosintez jarayonida o'simliklar nimani ishlab chiqaradi?", options: ["Karbonat angidrid", "Kislorod", "Azot", "Vodorod"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Dunyoda eng ko'p gapiriladigan til qaysi?", options: ["Ingliz tili", "Xitoy tili", "Ispan tili", "Hind tili"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Bir yilda necha kun bor (kabisa yili emas)?", options: ["364", "365", "366", "367"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Insonning eng katta organi qaysi?", options: ["Jigar", "Miya", "Teri", "O'pka"], correctIndex: 2 },
  { category: 'umumiy_bilim', text: "Qaysi metall xona haroratida suyuq holatda bo'ladi?", options: ["Temir", "Simob", "Mis", "Kumush"], correctIndex: 1 },
  // sport_kino_musiqa
  { category: 'sport_kino_musiqa', text: "Futbolda bir jamoada nechta o'yinchi maydonda bo'ladi?", options: ["9", "10", "11", "12"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Olimpiya o'yinlari necha yilda bir marta o'tkaziladi?", options: ["2", "3", "4", "5"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "\"Titanik\" filmi qaysi yili chiqqan?", options: ["1995", "1997", "1999", "2001"], correctIndex: 1 },
  { category: 'sport_kino_musiqa', text: "Basketbolda bir jamoada nechta o'yinchi maydonda bo'ladi?", options: ["4", "5", "6", "7"], correctIndex: 1 },
  { category: 'sport_kino_musiqa', text: "Michael Jackson qaysi janrning \"qiroli\" deb ataladi?", options: ["Rok", "Jaz", "Pop", "Klassik"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Jahon chempionati (futbol) necha yilda bir o'tkaziladi?", options: ["2", "3", "4", "5"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "\"Harry Potter\" seriyasi nechta asosiy kitobdan iborat?", options: ["5", "6", "7", "8"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Tennisda \"Grand Slam\" turnirlaridan biri qaysi?", options: ["Wimbledon", "Champions League", "Super Bowl", "NBA Finals"], correctIndex: 0 },
  { category: 'sport_kino_musiqa', text: "Real Madrid va Barcelona qaysi mamlakat klublari?", options: ["Portugaliya", "Italiya", "Ispaniya", "Fransiya"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Qaysi cholg'u asbobi \"musiqa asboblari qiroli\" deb ataladi?", options: ["Skripka", "Pianino", "Gitara", "Nay"], correctIndex: 1 },
];

async function seed(): Promise<void> {
  for (const q of questions) {
    await pool.query(
      `INSERT INTO questions (category, question_text, options, correct_index) VALUES ($1, $2, $3, $4)`,
      [q.category, q.text, JSON.stringify(q.options), q.correctIndex]
    );
  }
  console.log(`Seeded ${questions.length} questions.`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
