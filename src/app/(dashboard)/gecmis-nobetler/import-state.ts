// Geçmiş nöbet içe aktarma akışının useActionState durumu.
// ("use server" dosyaları yalnızca async fonksiyon dışa aktarabildiği için
// tipler ve başlangıç değeri ayrı bir modüldedir.)

export type ImportPreviewRow = {
  rowNumber: number;
  rawDate: string;
  rawPharmacyName: string;
  matchedPharmacyName: string | null;
  regionName: string | null;
  dutyType: string;
  weight: number;
  status: "OK" | "WARNING" | "ERROR";
  messages: string[];
};

export type ImportActionState = {
  success: boolean;
  message: string;
  preview?: {
    fileName: string;
    rows: ImportPreviewRow[];
    totalCount: number;
    okCount: number;
    warningCount: number;
    errorCount: number;
    matchedCount: number;
    canImport: boolean;
  };
};

export const initialImportState: ImportActionState = {
  success: false,
  message: "",
};

// Önizleme tablosunda gösterilecek azami satır (tamamı analiz edilir).
export const PREVIEW_DISPLAY_LIMIT = 200;
