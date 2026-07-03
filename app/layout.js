import './globals.css';

export const metadata = {
  title: 'YOGIBO 집기 입출고 관리',
  description: '물류센터 VMD 집기 재고 · 출고 · 회수 관리',
  icons: { icon: 'https://yogibo.kr/web/img/icon/logo3_on.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
