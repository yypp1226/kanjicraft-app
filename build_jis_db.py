# build_jis_db.py (신 JLPT N1~N5 완벽 매핑 버전)
import urllib.request
import gzip
import json
import xml.etree.ElementTree as ET
import io
import re

print("🚀 [JIS 마스터 한자 DB] 신 JLPT N1~N5 정밀 매핑 빌드를 시작합니다...")

# 1. KANJIDIC2 다운로드 및 파싱
kanjidic_url = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
print("1/2. 일본어 한자 사전(KANJIDIC2) 다운로드 및 파싱 중...")

req = urllib.request.Request(kanjidic_url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    with gzip.GzipFile(fileobj=io.BytesIO(response.read())) as gz:
        tree = ET.parse(gz)
        root = tree.getroot()

jis_kanji_map = {}
junior_high_pool = []

for character in root.findall('character'):
    literal = character.find('literal').text
    
    # 획수
    stroke_el = character.find('.//stroke_count')
    strokes = int(stroke_el.text) if stroke_el is not None else 0
    
    # 🌟 신 JLPT N1 ~ N5 변환 매핑
    jlpt_el = character.find('.//jlpt')
    raw_jlpt = int(jlpt_el.text) if jlpt_el is not None else None
    jlpt_str = None
    
    if raw_jlpt == 4:
        jlpt_str = "JLPT N5"
    elif raw_jlpt == 3:
        jlpt_str = "JLPT N4"
    elif raw_jlpt == 2:
        jlpt_str = "JLPT N2" # 또는 N3
    elif raw_jlpt == 1:
        jlpt_str = "JLPT N1" # 🌟 구 1급 = 신 N1 (약 1,000자)
    
    # 문부과학성 교육한자 등급 (Grade)
    grade_el = character.find('.//grade')
    grade_num = int(grade_el.text) if grade_el is not None else None

    # 음독(ja_on), 훈독(ja_kun)
    onyomi_list = []
    kunyomi_list = []
    for rm in character.findall('.//reading_meaning/rmgroup/reading'):
        r_type = rm.attrib.get('r_type')
        if r_type == 'ja_on' and rm.text:
            onyomi_list.append(rm.text.strip())
        elif r_type == 'ja_kun' and rm.text:
            kunyomi_list.append(rm.text.strip())

    item_data = {
        "char": literal,
        "strokes": f"{strokes}획",
        "stroke_num": strokes,
        "jlpt": jlpt_str,
        "grade": grade_num,
        "schoolLevel": "",
        "onyomi": onyomi_list,
        "kunyomi": kunyomi_list,
        "koreanMean": "",
        "koreanSound": "",
        "formula": ""
    }

    # 기본 학년 분류
    if grade_num is not None:
        if 1 <= grade_num <= 6:
            item_data["schoolLevel"] = f"초{grade_num}"
            if not jlpt_str:
                item_data["jlpt"] = "JLPT N5" if grade_num <= 2 else ("JLPT N4" if grade_num <= 4 else "JLPT N3")
        elif grade_num == 8:
            junior_high_pool.append(literal)
        elif grade_num in [9, 10]:
            item_data["schoolLevel"] = "고등/인명용"
            if not jlpt_str: item_data["jlpt"] = "JLPT N1"
        else:
            item_data["schoolLevel"] = "고난도"
    else:
        item_data["schoolLevel"] = "고난도"

    jis_kanji_map[literal] = item_data

# 중학교 한자 분할 및 JLPT N3/N2/N1 보정
junior_high_pool.sort(key=lambda c: (
    0 if jis_kanji_map[c]['jlpt'] == 'JLPT N2' else (1 if jis_kanji_map[c]['jlpt'] == 'JLPT N1' else 2),
    jis_kanji_map[c]['stroke_num']
))

total_jh = len(junior_high_pool)
part_size = total_jh // 3

for idx, char in enumerate(junior_high_pool):
    if idx < part_size:
        jis_kanji_map[char]["schoolLevel"] = "중1"
        if not jis_kanji_map[char]["jlpt"]: jis_kanji_map[char]["jlpt"] = "JLPT N3"
    elif idx < part_size * 2:
        jis_kanji_map[char]["schoolLevel"] = "중2"
        if not jis_kanji_map[char]["jlpt"]: jis_kanji_map[char]["jlpt"] = "JLPT N2"
    else:
        jis_kanji_map[char]["schoolLevel"] = "중3"
        if not jis_kanji_map[char]["jlpt"]: jis_kanji_map[char]["jlpt"] = "JLPT N1"

for item in jis_kanji_map.values():
    item.pop("stroke_num", None)

print(f"✅ KANJIDIC2 한자 JLPT N1~N5 매핑 완료")

# 2. libhangul 훈음 매핑
print("2/2. 공식 libhangul 사전 매핑 중...")
libhangul_url = "https://raw.githubusercontent.com/libhangul/libhangul/master/data/hanja/hanja.txt"

try:
    req_ko = urllib.request.Request(libhangul_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req_ko) as res_ko:
        lines = res_ko.read().decode('utf-8').splitlines()
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'): continue
            parts = line.split(':')
            if len(parts) >= 2:
                sound_raw = parts[0].strip()
                char_raw = parts[1].strip()
                desc_raw = parts[2].strip() if len(parts) >= 3 else ""
                if len(char_raw) == 1 and char_raw in jis_kanji_map:
                    char = char_raw
                    if not jis_kanji_map[char]['koreanMean']:
                        sound = sound_raw
                        mean = ""
                        if desc_raw:
                            first_desc = re.split(r'[,;/]', desc_raw)[0].strip()
                            words = first_desc.split()
                            if len(words) >= 2:
                                sound = words[-1]
                                mean = " ".join(words[:-1])
                            elif len(words) == 1:
                                mean = words[0]
                        if sound:
                            jis_kanji_map[char]['koreanSound'] = sound
                            jis_kanji_map[char]['koreanMean'] = mean or f"{sound}할"
                            jis_kanji_map[char]['formula'] = f"한국어 훈음: {mean} {sound}" if mean else f"한자 독음: {sound}"
except Exception as e:
    print(f"⚠️ libhangul 오류: {e}")

# 3. 기본값 보정
for char, item in jis_kanji_map.items():
    if not item['koreanSound']: item['koreanSound'] = "-"
    if not item['koreanMean']:
        item['koreanMean'] = "뜻 직접입력"
        item['formula'] = f"JIS 한자 ({item['strokes']})"

output_path = "jis_kanji_master_db.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(jis_kanji_map, f, ensure_ascii=False, indent=2)

print(f"\n🎉 [완료] JLPT N1 포함 전체 데이터베이스 생성 완료: {output_path}")