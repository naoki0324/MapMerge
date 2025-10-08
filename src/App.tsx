import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  RefreshCcw,
  Search,
  Target,
  Trash2,
} from "lucide-react";

const COLOR_PALETTE = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#835AF1"];
const PLACE_LABELS = "ABCDEFGHIJ";
const DEFAULT_CENTER = { lat: 35.681236, lng: 139.767125 };
const STATUS_MESSAGE_MAP: Record<string, string> = {
  ZERO_RESULTS: "該当するスポットが見つかりませんでした。",
  OVER_QUERY_LIMIT: "API利用制限を超えました。時間をおいて再試行してください。",
  REQUEST_DENIED: "APIリクエストが拒否されました。APIキーとリファラー制限を確認してください。",
  INVALID_REQUEST: "検索条件が正しくありません。キーワードを確認してください。",
  UNKNOWN_ERROR: "一時的に結果を取得できませんでした。再度お試しください。",
  NOT_FOUND: "場所情報が見つかりませんでした。",
};
const BUSINESS_STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: "営業中",
  CLOSED_TEMPORARILY: "一時閉鎖",
  CLOSED_PERMANENTLY: "閉業",
};

const placeholderPins = COLOR_PALETTE.map((color, index) => ({
  setId: `placeholder-${index}`,
  label: PLACE_LABELS[index] ?? String(index + 1),
  color,
  top: `${20 + index * 8}%`,
  left: `${35 + index * 6}%`,
}));

type PlaceEntry = {
  label: string;
  name: string;
  address: string;
  rating?: string;
  isOpenNow?: boolean | null;
  businessStatus?: string;
  priceLevel?: number;
  link: string;
  coords?: { lat: number; lng: number };
};

type SearchSet = {
  id: string;
  query: string;
  color: string;
  openFilter: boolean;
  retrievedAt: string;
  durationMs: number;
  status: "success" | "error";
  errorMessage?: string;
  isRefreshing?: boolean;
  results: PlaceEntry[];
};

type Feedback = {
  type: "info" | "error";
  message: string;
};

type CollapsibleSectionProps = {
  title: string;
  description?: string;
  rightLabel?: string;
  badgeLabel?: string;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function CollapsibleSection({
  title,
  description,
  rightLabel,
  badgeLabel,
  actions,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_12px_24px_-16px_rgba(58,66,86,0.35)]">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="group flex items-center gap-2 text-left"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/10 text-slate-600 transition group-hover:bg-slate-900/20">
              {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            </span>
            <span className="text-lg font-semibold text-slate-900">{title}</span>
          </button>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {rightLabel && <span>{rightLabel}</span>}
          {badgeLabel && <span className="rounded-full bg-slate-100 px-3 py-1">{badgeLabel}</span>}
          {actions}
        </div>
      </header>
      {open && <div className="space-y-4">{children}</div>}
    </section>
  );
}

function formatTimestamp(date: Date = new Date()) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function maskKey(key?: string) {
  if (!key) return "未設定";
  if (key.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

function translateStatus(status: string) {
  return STATUS_MESSAGE_MAP[status] ?? "Places APIの呼び出しに失敗しました。";
}

function translateBusinessStatus(status?: string) {
  if (!status) return undefined;
  return BUSINESS_STATUS_LABEL[status] ?? status;
}

function buildPlaceLink(placeId?: string) {
  if (!placeId) return "https://www.google.com/maps";
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const normalizedEnvKey = envKey && envKey !== "YOUR_GOOGLE_MAPS_API_KEY" ? envKey.trim() : undefined;

  const [searchTerm, setSearchTerm] = useState("");
  const [openNowOnly, setOpenNowOnly] = useState(true);
  const [compactResults, setCompactResults] = useState(false);
  const [searchSets, setSearchSets] = useState<SearchSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<Feedback | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [clientApiKey, setClientApiKey] = useState<string | undefined>(normalizedEnvKey);
  const [showKey, setShowKey] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState<Feedback | null>(null);

  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Array<{ marker: any; infoWindow?: any }>>([]);

  const timestampLabel = useMemo(() => formatTimestamp(), []);
  const hasApiKey = Boolean(clientApiKey);

  const initMap = useCallback(() => {
    const googleGlobal = (window as typeof window & { google?: any }).google;
    if (!googleGlobal?.maps || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new googleGlobal.maps.Map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
      });
    }
    setMapError(null);
    setMapReady(true);
  }, []);

  useEffect(() => {
    if (!clientApiKey) {
      setMapReady(false);
      setMapError(null);
      return;
    }

    const googleGlobal = (window as typeof window & { google?: any }).google;
    if (googleGlobal?.maps) {
      initMap();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-google-maps]");
    if (existingScript) {
      const handleLoad = () => initMap();
      const handleError = () => setMapError("Google Mapsの読み込みに失敗しました。APIキーを確認してください。");
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return () => {
        existingScript.removeEventListener("load", handleLoad);
        existingScript.removeEventListener("error", handleError);
      };
    }

    setIsLoadingMap(true);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${clientApiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";

    const handleLoad = () => {
      setIsLoadingMap(false);
      initMap();
    };
    const handleError = () => {
      setIsLoadingMap(false);
      setMapReady(false);
      setMapError("Google Mapsの読み込みに失敗しました。APIキーを確認してください。");
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, [clientApiKey, initMap]);

  useEffect(() => {
    if (!mapReady) return;
    const googleGlobal = (window as typeof window & { google?: any }).google;
    if (!googleGlobal?.maps || !mapInstanceRef.current) return;

    markersRef.current.forEach(({ marker, infoWindow }) => {
      marker.setMap(null);
      infoWindow?.close();
    });
    markersRef.current = [];

    const map = mapInstanceRef.current;
    if (searchSets.length === 0) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(12);
      return;
    }

    const bounds = new googleGlobal.maps.LatLngBounds();

    searchSets.forEach((set) => {
      const icon = {
        path: googleGlobal.maps.SymbolPath.CIRCLE,
        fillColor: set.color,
        fillOpacity: 1,
        strokeColor: "#FFFFFF",
        strokeWeight: 2,
        scale: 8,
      };

      set.results.forEach((result) => {
        if (!result.coords) return;
        const marker = new googleGlobal.maps.Marker({
          map,
          position: result.coords,
          label: {
            text: result.label,
            color: "#ffffff",
            fontWeight: "600",
          },
          icon,
          title: `${result.name} (${set.query})`,
        });

        const infoWindow = new googleGlobal.maps.InfoWindow({
          content: `
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${result.name}</div>
            <div style="font-size:12px;color:#475569;line-height:1.4;">${result.address ?? "住所情報なし"}</div>
          `,
        });

        marker.addListener("click", () => infoWindow.open({ anchor: marker, map }));
        markersRef.current.push({ marker, infoWindow });
        bounds.extend(result.coords);
      });
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
      const listener = googleGlobal.maps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 16) map.setZoom(16);
      });
      googleGlobal.maps.event.addListenerOnce(map, "idle", () => {
        googleGlobal.maps.event.removeListener(listener);
      });
    }
  }, [mapReady, searchSets]);

  const performSearch = useCallback(
    (query: string, openNow: boolean): Promise<Omit<SearchSet, "id" | "color" | "openFilter">> => {
      return new Promise((resolve) => {
        const googleGlobal = (window as typeof window & { google?: any }).google;
        const map = mapInstanceRef.current;
        if (!googleGlobal?.maps?.places || !map) {
          resolve({
            query,
            retrievedAt: formatTimestamp(),
            durationMs: 0,
            status: "error",
            errorMessage: "Google Mapsが初期化されていません。APIキーを確認してください。",
            results: [],
          });
          return;
        }

        const service = new googleGlobal.maps.places.PlacesService(map);
        const start = performance.now();

        const fetchDetail = (placeId: string, fallbackStatus?: string) =>
          new Promise<{ isOpenNow?: boolean | null; businessStatus?: string }>((detailResolve) => {
            service.getDetails(
              { placeId, fields: ["opening_hours", "business_status"] },
              (details: any, status: string) => {
                if (status === googleGlobal.maps.places.PlacesServiceStatus.OK && details) {
                  const openMethod = details.opening_hours?.isOpen;
                  const isOpenNow = typeof openMethod === "function" ? openMethod.call(details.opening_hours) : undefined;
                  detailResolve({
                    isOpenNow: isOpenNow ?? null,
                    businessStatus: details.business_status ?? fallbackStatus,
                  });
                } else {
                  detailResolve({ businessStatus: fallbackStatus });
                }
              }
            );
          });

        service.textSearch(
          {
            query,
            openNow,
            region: "jp",
          },
          (places: any[], status: string) => {
            const durationMs = Math.round(performance.now() - start);

            if (
              status === googleGlobal.maps.places.PlacesServiceStatus.OK ||
              status === googleGlobal.maps.places.PlacesServiceStatus.ZERO_RESULTS
            ) {
              const rawPlaces = places ?? [];
              const normalized = rawPlaces.slice(0, 10).map((place, idx) => {
                const geometry = place.geometry?.location;
                const coords = geometry
                  ? { lat: geometry.lat?.() ?? geometry.lat, lng: geometry.lng?.() ?? geometry.lng }
                  : undefined;
                return {
                  label: PLACE_LABELS[idx] ?? String(idx + 1),
                  name: place.name ?? "名称不明",
                  address: place.formatted_address ?? place.vicinity ?? "住所情報なし",
                  rating: place.rating ? Number(place.rating).toFixed(1) : undefined,
                  priceLevel: place.price_level ?? undefined,
                  link: buildPlaceLink(place.place_id),
                  coords,
                  businessStatus: place.business_status ?? undefined,
                } satisfies PlaceEntry;
              });

              const enrich = async () => {
                const annotated = await Promise.all(
                  normalized.map(async (entry, idx) => {
                    const place = rawPlaces[idx];
                    if (!place?.place_id) {
                      return {
                        ...entry,
                        businessStatus: translateBusinessStatus(entry.businessStatus),
                      } satisfies PlaceEntry;
                    }
                    const detail = await fetchDetail(place.place_id, place.business_status ?? entry.businessStatus);
                    return {
                      ...entry,
                      isOpenNow: detail.isOpenNow ?? null,
                      businessStatus: translateBusinessStatus(detail.businessStatus ?? place.business_status),
                    } satisfies PlaceEntry;
                  })
                );

                resolve({
                  query,
                  retrievedAt: formatTimestamp(),
                  durationMs,
                  status: "success",
                  errorMessage:
                    status === googleGlobal.maps.places.PlacesServiceStatus.ZERO_RESULTS
                      ? "該当するスポットが見つかりませんでした。"
                      : undefined,
                  results: annotated,
                });
              };

              void enrich();
              return;
            }

            resolve({
              query,
              retrievedAt: formatTimestamp(),
              durationMs,
              status: "error",
              errorMessage: translateStatus(status),
              results: [],
            });
          }
        );
      });
    },
    []
  );

  const handleSearchSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchFeedback(null);

    const query = searchTerm.trim();
    if (!query) {
      setSearchFeedback({ type: "error", message: "検索キーワードを入力してください。" });
      return;
    }

    if (!hasApiKey) {
      setSearchFeedback({ type: "error", message: "Google Maps APIキーを設定してください。" });
      return;
    }

    if (!mapReady) {
      setSearchFeedback({ type: "error", message: "マップの初期化を待機しています。数秒後に再試行してください。" });
      return;
    }

    if (searchSets.length >= 5) {
      setSearchFeedback({ type: "error", message: "同時検索は最大5件までです。不要な結果を削除してください。" });
      return;
    }

    setIsSearching(true);
    const payload = await performSearch(query, openNowOnly);
    setIsSearching(false);

    const newSet: SearchSet = {
      id: `set-${Date.now()}`,
      query,
      color: COLOR_PALETTE[searchSets.length % COLOR_PALETTE.length],
      openFilter: openNowOnly,
      ...payload,
    };

    setSearchSets((prev) => [newSet, ...prev]);
    setActiveSetId(newSet.id);
    setSearchTerm("");

    if (payload.status === "error") {
      setSearchFeedback({ type: "error", message: payload.errorMessage ?? "検索に失敗しました。" });
    } else if (payload.results.length === 0) {
      setSearchFeedback({ type: "info", message: payload.errorMessage ?? "該当するスポットが見つかりませんでした。" });
    }
  };

  const handleApplyKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setKeyFeedback({ type: "error", message: "APIキーを入力してください。" });
      return;
    }
    setClientApiKey(trimmed);
    setApiKeyInput("");
    setKeyFeedback({ type: "info", message: "APIキーを適用しました。マップ初期化を待っています。" });
    setIsLoadingMap(true);
  };

  const handleFocusSet = (setId: string) => {
    const googleGlobal = (window as typeof window & { google?: any }).google;
    if (!mapReady || !mapInstanceRef.current || !googleGlobal?.maps) return;
    const target = searchSets.find((set) => set.id === setId);
    if (!target) return;

    const bounds = new googleGlobal.maps.LatLngBounds();
    target.results.forEach((result) => {
      if (result.coords) bounds.extend(result.coords);
    });

    if (!bounds.isEmpty()) {
      mapInstanceRef.current.fitBounds(bounds);
    } else {
      mapInstanceRef.current.setCenter(DEFAULT_CENTER);
      mapInstanceRef.current.setZoom(13);
    }

    setActiveSetId(setId);
  };

  const handleRemoveSet = (setId: string) => {
    setSearchSets((prev) => {
      const filtered = prev.filter((set) => set.id !== setId);
      setActiveSetId((current) => (current === setId ? filtered[0]?.id ?? null : current));
      return filtered;
    });
  };

  const handleRefetchSet = async (setId: string) => {
    const target = searchSets.find((set) => set.id === setId);
    if (!target) return;

    setSearchSets((prev) => prev.map((set) => (set.id === setId ? { ...set, isRefreshing: true } : set)));
    const payload = await performSearch(target.query, target.openFilter);

    setSearchSets((prev) =>
      prev.map((set) =>
        set.id === setId
          ? {
              ...set,
              ...payload,
              isRefreshing: false,
            }
          : set
      )
    );

    if (payload.status === "error") {
      setSearchFeedback({ type: "error", message: payload.errorMessage ?? "再検索に失敗しました。" });
    }
  };

  const totalResults = searchSets.reduce((acc, set) => acc + set.results.length, 0);

  return (
    <div className="min-h-screen bg-[#F7F5F2] text-slate-800">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-lg font-semibold text-slate-900">MapMerge</p>
          </div>

          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {timestampLabel}
            </div>
            <div className="rounded-full bg-slate-900/10 px-3 py-1 text-xs text-slate-600">
              検索済みセット: {searchSets.length} / 5 ・ スポット総数: {totalResults}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <CollapsibleSection
          title="検索"
          description="最大5件まで同時に保存でき、Google Maps 上に色分け表示されます。"
          rightLabel="Places API テキスト検索（1回10件取得）"
          defaultOpen
        >
          <form className="space-y-4" onSubmit={handleSearchSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              キーワード
              <input
                className="mt-2 w全 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-inner focus:border-slate-400 focus:outline-none"
                placeholder="例：渋谷 カフェ"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setSearchFeedback(null);
                }}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <button
                  type="button"
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                    openNowOnly ? "bg-slate-900" : "bg-slate-300"
                  }`}
                  onClick={() => setOpenNowOnly((prev) => !prev)}
                  aria-pressed={openNowOnly}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${
                      openNowOnly ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                  <span className="sr-only">現在営業中のみ</span>
                </button>
                <span>現在営業中のみ</span>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                {searchFeedback && (
                  <p className={`text-xs ${searchFeedback.type === "error" ? "text-rose-600" : "text-slate-500"}`}>
                    {searchFeedback.message}
                  </p>
                )}
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={isSearching || !hasApiKey || !mapReady}
                >
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                  {isSearching ? "検索中..." : "この条件で検索"}
                </button>
              </div>
            </div>
          </form>
        </CollapsibleSection>

        <CollapsibleSection
          title="検索結果"
          description="保存済みセットからマップフォーカス、再検索、削除が行えます。"
          badgeLabel={`${searchSets.length}件表示中`}
          actions={
            <button
              type="button"
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
              onClick={() => setCompactResults((prev) => !prev)}
            >
              {compactResults ? "フル表示" : "縮小表示"}
            </button>
          }
          defaultOpen
        >
          {searchSets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center text-sm text-slate-500">
              まだ検索がありません。上部のフォームからキーワードを入力して検索を開始してください。
            </div>
          ) : (
            <div className="space-y-4">
              {searchSets.map((set) => {
                const isActive = activeSetId === set.id;
                return (
                  <article
                    key={set.id}
                    className={`rounded-2xl border bg-white p-5 shadow-sm transition ${
                      isActive ? "border-slate-400 shadow-[0_10px_24px_-18px_rgba(30,41,59,0.45)]" : "border-slate-200"
                    }`}
                  >
                    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-1 inline-flex h-3 w-3 rounded-full"
                          style={{ backgroundColor: set.color }}
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{set.query}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-1">取得 {set.results.length} / 10 件</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">所要 {set.durationMs}ms</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{set.openFilter ? "営業中フィルタ ON" : "営業中フィルタ OFF"}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{set.retrievedAt}</span>
                          </div>
                          {set.status === "error" && set.errorMessage && (
                            <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                              {set.errorMessage}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white transition hover:bg-slate-700"
                          onClick={() => handleFocusSet(set.id)}
                        >
                          <Target className="h-3.5 w-3.5" aria-hidden="true" />
                          マップにフォーカス
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => handleRefetchSet(set.id)}
                          disabled={set.isRefreshing}
                        >
                          {set.isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                          再検索
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg bg-rose-100 px-3 py-2 font-semibold text-rose-500 transition hover:bg-rose-200"
                          onClick={() => handleRemoveSet(set.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          削除
                        </button>
                      </div>
                    </header>

                    {compactResults ? (
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                        {set.results.map((result) => (
                          <span
                            key={`${set.id}-${result.label}`}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1"
                          >
                            <span
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                              style={{ backgroundColor: set.color }}
                            >
                              {result.label}
                            </span>
                            <span className="truncate max-w-[160px]">{result.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      set.results.length > 0 && (
                        <ul className="mt-4 space-y-3">
                          {set.results.map((result) => (
                            <li
                              key={`${set.id}-${result.label}`}
                              className="group flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 transition hover:-translate-y-0.5 hover:bg-white hover:shadow"
                            >
                              <div
                                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                                style={{ backgroundColor: set.color }}
                              >
                                {result.label}
                              </div>
                              <div className="flex-1">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <a
                                    href={result.link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm font-semibold text-slate-900 hover:underline"
                                  >
                                    {result.name}
                                  </a>
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    {result.rating && <span>★ {result.rating}</span>}
                                    {typeof result.isOpenNow === "boolean" ? (
                                      <span
                                        className={`rounded-full px-2 py-1 ${
                                          result.isOpenNow ? "bg-emerald-500/15 text-emerald-600" : "bg-slate-200 text-slate-600"
                                        }`}
                                      >
                                        {result.isOpenNow ? "営業中" : "営業時間外"}
                                      </span>
                                    ) : result.businessStatus ? (
                                      <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-600">
                                        {result.businessStatus}
                                      </span>
                                    ) : null}
                                    {typeof result.priceLevel === "number" && (
                                      <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-600">
                                        {"¥".repeat(result.priceLevel + 1)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <p className="text-xs text-slate-500">{result.address}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="マップビュー"
          description="検索セットが色分けされたマーカーとして表示されます。"
          badgeLabel={hasApiKey ? "APIキー設定済み" : "APIキー未設定"}
          defaultOpen
        >
          <div className="space-y-4 rounded-2xl border border-white/60 bg-white/70 p-4 text-sm text-slate-600 shadow-inner">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <label className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Google Maps APIキー
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-slate-400 focus:outline-none"
                    placeholder="sk-..."
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? "APIキーを非表示" : "APIキーを表示"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-slate-700"
                    onClick={handleApplyKey}
                  >
                    適用
                  </button>
                </div>
              </label>
            </div>
            <div className="flex flex-col gap-1 text-xs text-slate-500">
              <p>
                現在のキー: <span className="font-semibold text-slate-700">{maskKey(clientApiKey)}</span>
              </p>
              <p>入力したキーはブラウザメモリのみで保持し、ストレージには保存しません。</p>
              {normalizedEnvKey && <p className="text-slate-400">環境変数に設定されたキーも初期読み込みに利用されます。</p>}
              {keyFeedback && (
                <span className={keyFeedback.type === "error" ? "text-rose-600" : "text-slate-600"}>{keyFeedback.message}</span>
              )}
              {mapError && <span className="text-rose-600">{mapError}</span>}
            </div>
          </div>

          <div className="relative mt-6 h-[520px] overflow-hidden rounded-[24px] border border-white/40 bg-white/50 shadow-inner">
            <div
              ref={mapContainerRef}
              className={`absolute inset-0 transition-opacity duration-300 ${mapReady ? "opacity-100" : "opacity-0"}`}
            />

            {!mapReady && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white/85 text-center text-sm text-slate-600">
                {isLoadingMap ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-hidden="true" />
                    <p>Google Maps を読み込み中です...</p>
                  </>
                ) : (
                  <>
                    <div className="rounded-full bg-rose-100 px-4 py-2 text-rose-600">APIキー未設定</div>
                    <p className="max-w-xs text-slate-500">キーを設定すると、ここに実際の Google Maps が表示されます。</p>
                  </>
                )}
              </div>
            )}

            {!mapReady && (
              <div className="absolute inset-0">
                {placeholderPins.map((marker) => (
                  <div
                    key={`${marker.setId}-${marker.label}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ top: marker.top, left: marker.left }}
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white shadow-lg"
                      style={{ backgroundColor: marker.color }}
                    >
                      {marker.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mapReady && searchSets.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/70 text-sm text-slate-500">
                <p>検索結果がまだありません。</p>
                <p>上部のフォームから検索すると、ここにマーカーが表示されます。</p>
              </div>
            )}

            <div className="absolute right-4 top-4 flex w-60 flex-col gap-2 rounded-2xl bg-white/90 p-4 shadow-lg backdrop-blur">
              <h3 className="text-xs font-semibold text-slate-500">凡例 / アクション</h3>
              <div className="space-y-3">
                {searchSets.map((set) => (
                  <div key={`${set.id}-legend`} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: set.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate font-semibold text-slate-700">{set.query}</span>
                    <button
                      className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-500 transition hover:bg-slate-200"
                      onClick={() => handleFocusSet(set.id)}
                    >
                      フォーカス
                    </button>
                  </div>
                ))}
                {searchSets.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    検索セットが追加されるとここに表示されます。
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              className="absolute bottom-6 left-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-700"
              onClick={() => {
                if (!mapReady || !mapInstanceRef.current) return;
                const googleGlobal = (window as typeof window & { google?: any }).google;
                if (!googleGlobal?.maps) return;
                if (searchSets.length === 0) {
                  mapInstanceRef.current.setCenter(DEFAULT_CENTER);
                  mapInstanceRef.current.setZoom(12);
                  return;
                }
                const bounds = new googleGlobal.maps.LatLngBounds();
                searchSets.forEach((set) => {
                  set.results.forEach((result) => {
                    if (result.coords) bounds.extend(result.coords);
                  });
                });
                if (!bounds.isEmpty()) {
                  mapInstanceRef.current.fitBounds(bounds);
                }
              }}
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              全体表示
            </button>
          </div>
        </CollapsibleSection>
      </main>
    </div>
  );
}

export default App;
