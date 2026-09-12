// 여기에 Google Cloud Console에서 발급받은(또는 기존 두 앱과 공유하는)
// OAuth 클라이언트 ID를 붙여넣으세요.
// 예: "123456789-abcdefg.apps.googleusercontent.com"
const CONFIG = {
  CLIENT_ID: "321289952793-7lipdspfso6letg45dgmdftlbdeqcnal.apps.googleusercontent.com",

  // drive: Drive 전체에 접근 가능한 권한.
  // 이미 존재하는 폴더를 직접 지정해서 쓰려면 이 범위가 필요함.
  // (개인/테스트 계정으로만 쓰는 경우 별도 Google 심사 없이 사용 가능)
  SCOPES: "https://www.googleapis.com/auth/drive",

  // Drive에서 직접 만든 폴더의 ID를 붙여넣으세요.
  // 폴더를 열었을 때 주소창의 .../folders/ 뒤에 나오는 문자열입니다.
  FOLDER_ID: "1yOCFd6kutO5WExtJEqXmXA0hsOblkpKk",
  JOURNAL_FILENAME: "journal.json",

  // 캘린더 화면(舊 LOG 앱)의 데이터 파일명.
  // 저널과 같은 FOLDER_ID 안에 별도 파일로 저장됨.
  CALENDAR_FILENAME: "calendar.json",
};
