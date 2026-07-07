import { redirect } from "next/navigation";

// Eski "Adalet Raporu" adresi geriye dönük uyumluluk için korunur;
// kavram "Nöbet Dengesi / Nöbet Yükü Analizi" olarak yeniden adlandırıldı.
export default function AdaletRaporuRedirectPage() {
  redirect("/nobet-dengesi");
}
