// frontend/src/components/QuestionImportForm.tsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { importQuestions } from '../api/admin';
import { QuestionImportResult } from '../api/types';

const INGLIZ_TILI_CATEGORY_KEY = 'ingliz_tili';

export function QuestionImportForm() {
  const { token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUpload = !uploading && file !== null;

  const handleUpload = async () => {
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', INGLIZ_TILI_CATEGORY_KEY);

    try {
      const res = await importQuestions(formData, token);
      setResult(res);
      setFile(null);
      setFileInputKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <h3 className="text-sm font-semibold text-ios-label">Savol qo'shish</h3>

      <input
        key={fileInputKey}
        type="file"
        aria-label="Fayl"
        accept=".docx"
        disabled={uploading}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
          setResult(null);
        }}
      />

      <button
        type="button"
        disabled={!canUpload}
        onClick={handleUpload}
        className="rounded-full bg-ios-blue py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {uploading ? 'Yuklanmoqda...' : 'Yuklash'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-ios-green">
            ✅ {result.inserted} ta savol qo'shildi ({result.category.label})
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ios-red">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.line}-qatorda: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ios-red">{error}</p>}
    </div>
  );
}
