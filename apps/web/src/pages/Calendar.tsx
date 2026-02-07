import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link, useSearch } from '@tanstack/react-router';
import type { CalendarItem, CalendarItemStatus, CalendarItemType } from '@shared/calendar';
import type { CalendarDay } from '../utils/calendarUtils';
import { getMonthRange, groupItemsByDay, getEstimatedMinutes } from '../utils/calendarUtils';
import { listCalendarItems, type CalendarViewMode } from '../services/calendarService';
import { listCrews, type Crew } from '../services/crewService';
import { useNatsStore } from '../stores/natsStore';
import { CalendarGrid } from '../components/calendar';
import styles from './Calendar.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

const MONTH_NAMES = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
];

const ITEM_TYPES: CalendarItemType[] = ['revision', 'visit', 'task'];
const STATUS_FILTERS: CalendarItemStatus[] = [
  'scheduled',
  'overdue',
  'in_progress',
  'completed',
  'cancelled',
  'due',
  'pending',
];

type LayoutMode = 'month' | 'agenda';

interface CalendarSearchParams {
  view?: CalendarViewMode;
  layout?: LayoutMode;
  types?: string;
  status?: string;
  crew?: string;
  customer?: string;
}

function parseListParam<T extends string>(value: string | undefined, allowed: T[]): T[] {
  if (!value) return [...allowed];
  const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const filtered = values.filter((entry): entry is T => allowed.includes(entry as T));
  return filtered.length > 0 ? filtered : [...allowed];
}

function formatListParam(values: string[], fallback: string[]): string | undefined {
  if (values.length === 0) return fallback.join(',');
  return values.join(',');
}

function getCalendarStatusLabel(status: CalendarItemStatus): string {
  const labels: Record<CalendarItemStatus, string> = {
    scheduled: 'Naplánováno',
    overdue: 'Po termínu',
    in_progress: 'Probíhá',
    completed: 'Dokončeno',
    cancelled: 'Zrušeno',
    due: 'Termín',
    pending: 'Čeká',
  };
  return labels[status] || status;
}

function getItemLink(item: CalendarItem) {
  if (item.type === 'revision') {
    return { to: '/revisions/$revisionId' as const, params: { revisionId: item.id } };
  }
  if (item.customerId) {
    return { to: '/customers/$customerId' as const, params: { customerId: item.customerId } };
  }
  return null;
}

function getItemTitle(item: CalendarItem): string {
  if (item.type === 'task') {
    return item.customerName || item.title || 'Follow-up';
  }
  return item.customerName || item.title || 'Zákazník';
}

function getCrewCapacityMinutes(crew?: Crew | null): number | null {
  if (!crew?.workingHoursStart || !crew?.workingHoursEnd) return null;
  const [startH, startM] = crew.workingHoursStart.split(':').map(Number);
  const [endH, endM] = crew.workingHoursEnd.split(':').map(Number);
  if (Number.isNaN(startH) || Number.isNaN(endH)) return null;
  const minutes = (endH * 60 + endM) - (startH * 60 + startM);
  return minutes > 0 ? minutes : null;
}

export function Calendar() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as CalendarSearchParams;
  const isConnected = useNatsStore((s) => s.isConnected);

  const initialViewMode = searchParams.view === 'scheduled' ? 'scheduled' : 'due';
  const initialLayout = searchParams.layout === 'agenda' ? 'agenda' : 'month';
  const initialTypes = parseListParam(searchParams.types, ITEM_TYPES);
  const initialStatus = parseListParam(searchParams.status, STATUS_FILTERS);

  // View mode: show by due_date or scheduled_date
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialViewMode);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayout);
  const [selectedTypes, setSelectedTypes] = useState<CalendarItemType[]>(initialTypes);
  const [selectedStatus, setSelectedStatus] = useState<CalendarItemStatus[]>(initialStatus);
  const [selectedCrew, setSelectedCrew] = useState<string>(searchParams.crew || '');
  const [customerQuery, setCustomerQuery] = useState<string>(searchParams.customer || '');

  // Current displayed month
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());

  // Data state
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected day state (for modal/details)
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [selectedItems, setSelectedItems] = useState<CalendarItem[]>([]);

  const updateSearchParams = useCallback(
    (next: Partial<CalendarSearchParams>) => {
      navigate({
        to: '/calendar',
        search: {
          view: viewMode,
          layout: layoutMode,
          types: formatListParam(selectedTypes, ITEM_TYPES),
          status: formatListParam(selectedStatus, STATUS_FILTERS),
          crew: selectedCrew || undefined,
          customer: customerQuery || undefined,
          ...next,
        },
        replace: true,
      });
    },
    [navigate, viewMode, layoutMode, selectedTypes, selectedStatus, selectedCrew, customerQuery]
  );

  useEffect(() => {
    updateSearchParams({});
  }, [updateSearchParams]);

  useEffect(() => {
    listCrews(true)
      .then((data) => setCrews(data))
      .catch((err) => console.error('Failed to load crews:', err));
  }, []);

  // Load calendar items for the current month
  const loadItems = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { start, end } = getMonthRange(year, month);

      const response = await listCalendarItems(TEMP_USER_ID, {
        startDate: start,
        endDate: end,
        viewMode,
        types: selectedTypes,
        status: selectedStatus,
        crewId: selectedCrew || undefined,
        customerQuery: customerQuery || undefined,
      });

      setItems(response.items);
    } catch (err) {
      console.error('Failed to load calendar:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst kalendář');
    } finally {
      setIsLoading(false);
    }
  }, [
    isConnected,
    year,
    month,
    viewMode,
    selectedTypes,
    selectedStatus,
    selectedCrew,
    customerQuery,
  ]);

  // Load items when filters change
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Navigation handlers
  const goToPreviousMonth = useCallback(() => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const goToNextMonth = useCallback(() => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const goToToday = useCallback(() => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }, []);

  // Handle day click - show details or navigate to planner
  const handleDayClick = useCallback((day: CalendarDay, dayItems: CalendarItem[]) => {
    setSelectedDay(day);
    setSelectedItems(dayItems);
  }, []);

  // Navigate to planner for selected date
  const handlePlanDay = useCallback(() => {
    if (selectedDay) {
      navigate({ to: '/planner', search: { date: selectedDay.dateKey, crew: selectedCrew || undefined } });
    }
  }, [navigate, selectedDay, selectedCrew]);

  // Close detail panel
  const handleCloseDetails = useCallback(() => {
    setSelectedDay(null);
    setSelectedItems([]);
  }, []);

  const groupedItems = useMemo(() => groupItemsByDay(items), [items]);

  const monthStats = useMemo(() => {
    const scheduled = items.filter((item) => item.status === 'scheduled').length;
    const overdue = items.filter((item) => item.status === 'overdue').length;
    const completed = items.filter((item) => item.status === 'completed').length;
    const pending = items.filter((item) => item.status === 'pending').length;
    return { scheduled, overdue, completed, pending, total: items.length };
  }, [items]);

  const workloadByDay = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) {
      if (!item.date) continue;
      result[item.date] = (result[item.date] || 0) + getEstimatedMinutes(item);
    }
    return result;
  }, [items]);

  const capacityByDay = useMemo(() => {
    const selectedCrewObj = crews.find((crew) => crew.id === selectedCrew) || null;
    const selectedCrewMinutes = getCrewCapacityMinutes(selectedCrewObj);
    const totalMinutes = selectedCrewMinutes ?? crews.reduce((sum, crew) => {
      const minutes = getCrewCapacityMinutes(crew);
      return minutes ? sum + minutes : sum;
    }, 0);

    if (!totalMinutes) return {};
    const { start, end } = getMonthRange(year, month);
    const startDate = new Date(start);
    const endDate = new Date(end);
    const result: Record<string, number> = {};
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const key = date.toISOString().substring(0, 10);
      result[key] = totalMinutes;
    }
    return result;
  }, [crews, selectedCrew, year, month]);

  const agendaItems = useMemo(() => {
    const dates = Object.keys(groupedItems).sort();
    return dates.map((dateKey) => ({
      dateKey,
      items: groupedItems[dateKey].slice().sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || '')),
    }));
  }, [groupedItems]);

  const toggleType = (type: CalendarItemType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((entry) => entry !== type)
      : [...selectedTypes, type];
    const resolved = next.length === 0 ? [...ITEM_TYPES] : next;
    setSelectedTypes(resolved);
    updateSearchParams({ types: formatListParam(resolved, ITEM_TYPES) });
  };

  const toggleStatus = (status: CalendarItemStatus) => {
    const next = selectedStatus.includes(status)
      ? selectedStatus.filter((entry) => entry !== status)
      : [...selectedStatus, status];
    const resolved = next.length === 0 ? [...STATUS_FILTERS] : next;
    setSelectedStatus(resolved);
    updateSearchParams({ status: formatListParam(resolved, STATUS_FILTERS) });
  };

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <h1>Kalendář</h1>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewButton} ${viewMode === 'due' ? styles.active : ''}`}
            onClick={() => {
              setViewMode('due');
              updateSearchParams({ view: 'due' });
            }}
          >
            Termíny
          </button>
          <button
            className={`${styles.viewButton} ${viewMode === 'scheduled' ? styles.active : ''}`}
            onClick={() => {
              setViewMode('scheduled');
              updateSearchParams({ view: 'scheduled' });
            }}
          >
            Naplánované
          </button>
        </div>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewButton} ${layoutMode === 'month' ? styles.active : ''}`}
            onClick={() => {
              setLayoutMode('month');
              updateSearchParams({ layout: 'month' });
            }}
          >
            Měsíc
          </button>
          <button
            className={`${styles.viewButton} ${layoutMode === 'agenda' ? styles.active : ''}`}
            onClick={() => {
              setLayoutMode('agenda');
              updateSearchParams({ layout: 'agenda' });
            }}
          >
            Agenda
          </button>
        </div>
        <div className={styles.monthNav}>
          <button
            className="btn-secondary"
            onClick={goToPreviousMonth}
            aria-label="Předchozí měsíc"
          >
            ←
          </button>
          <button
            className={styles.todayButton}
            onClick={goToToday}
          >
            Dnes
          </button>
          <span className={styles.currentMonth}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            className="btn-secondary"
            onClick={goToNextMonth}
            aria-label="Další měsíc"
          >
            →
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Typy</span>
          {ITEM_TYPES.map((type) => (
            <button
              key={type}
              className={`${styles.filterButton} ${selectedTypes.includes(type) ? styles.activeFilter : ''}`}
              onClick={() => toggleType(type)}
            >
              {type === 'revision' ? 'Revize' : type === 'visit' ? 'Návštěvy' : 'Follow-up'}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Stavy</span>
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              className={`${styles.filterButton} ${selectedStatus.includes(status) ? styles.activeFilter : ''}`}
              onClick={() => toggleStatus(status)}
            >
              {getCalendarStatusLabel(status)}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Posádka</span>
          <select
            className={styles.select}
            value={selectedCrew}
            onChange={(event) => {
              setSelectedCrew(event.target.value);
              updateSearchParams({ crew: event.target.value || undefined });
            }}
          >
            <option value="">Všechny</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Zákazník</span>
          <input
            className={styles.input}
            value={customerQuery}
            placeholder="Hledat zákazníka"
            onChange={(event) => {
              setCustomerQuery(event.target.value);
              updateSearchParams({ customer: event.target.value || undefined });
            }}
          />
        </div>
      </div>

      {/* Month stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{monthStats.scheduled}</span>
          <span className={styles.statLabel}>Naplánováno</span>
        </div>
        <div className={`${styles.stat} ${styles.statOverdue}`}>
          <span className={styles.statValue}>{monthStats.overdue}</span>
          <span className={styles.statLabel}>Po termínu</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{monthStats.completed}</span>
          <span className={styles.statLabel}>Dokončeno</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{monthStats.pending}</span>
          <span className={styles.statLabel}>Follow-up</span>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={loadItems}>Zkusit znovu</button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="card">
        {isLoading ? (
          <div className={styles.loading}>Načítání kalendáře...</div>
        ) : layoutMode === 'month' ? (
          <CalendarGrid
            year={year}
            month={month}
            items={items}
            onDayClick={handleDayClick}
            workloadByDay={workloadByDay}
            capacityByDay={capacityByDay}
          />
        ) : (
          <div className={styles.agenda}>
            {agendaItems.length === 0 ? (
              <div className={styles.emptyDay}>
                <p>Žádné položky pro vybraný měsíc</p>
              </div>
            ) : (
              agendaItems.map(({ dateKey, items: dayItems }) => (
                <div key={dateKey} className={styles.agendaDay}>
                  <div className={styles.agendaHeader}>
                    <strong>{dateKey}</strong>
                    <span>{dayItems.length} položek</span>
                  </div>
                  <div className={styles.agendaList}>
                    {dayItems.map((item) => {
                      const link = getItemLink(item);
                      const content = (
                        <div className={styles.itemRow}>
                          <span className={styles.itemStatus}>{getCalendarStatusLabel(item.status)}</span>
                          <span className={styles.itemTime}>{item.timeStart || '--:--'}</span>
                          <span className={styles.itemTitle}>{getItemTitle(item)}</span>
                          <span className={styles.itemSubtitle}>{item.subtitle || item.sourceType}</span>
                        </div>
                      );
                      return link ? (
                        <Link
                          key={`${item.type}-${item.id}`}
                          to={link.to}
                          params={link.params}
                          className={styles.itemLink}
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={`${item.type}-${item.id}`} className={styles.itemLink}>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Day details panel */}
      {selectedDay && layoutMode === 'month' && (
        <div className={styles.detailsOverlay} onClick={handleCloseDetails}>
          <div className={styles.detailsPanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.detailsHeader}>
              <h2>{selectedDay.dayNumber}. {MONTH_NAMES[selectedDay.date.getMonth()]}</h2>
              <button
                className={styles.closeButton}
                onClick={handleCloseDetails}
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>

            {selectedItems.length === 0 ? (
              <div className={styles.emptyDay}>
                <p>Žádné položky pro tento den</p>
                <button className="btn-primary" onClick={handlePlanDay}>
                  Naplánovat den
                </button>
              </div>
            ) : (
              <>
                {(['revision', 'visit', 'task'] as CalendarItemType[]).map((type) => {
                  const grouped = selectedItems.filter((item) => item.type === type);
                  if (grouped.length === 0) return null;
                  return (
                    <div key={type} className={styles.section}>
                      <div className={styles.sectionHeader}>
                        {type === 'revision' ? 'Revize' : type === 'visit' ? 'Návštěvy' : 'Follow-up'}
                      </div>
                      <div className={styles.revisionList}>
                        {grouped.map((item) => {
                          const link = getItemLink(item);
                          const content = (
                            <>
                              <div className={styles.revisionStatus}>
                                {getCalendarStatusLabel(item.status)}
                              </div>
                              <div className={styles.revisionTime}>
                                {item.timeStart ? (
                                  <span>{item.timeStart.substring(0, 5)}</span>
                                ) : (
                                  <span>--:--</span>
                                )}
                              </div>
                              <div className={styles.revisionInfo}>
                                <span className={styles.revisionCustomer}>
                                  {getItemTitle(item)}
                                </span>
                                <span className={styles.revisionDevice}>
                                  {item.subtitle || item.sourceType || 'Položka'}
                                </span>
                              </div>
                              <span className={styles.revisionArrow}>→</span>
                            </>
                          );

                          return link ? (
                            <Link
                              key={`${item.type}-${item.id}`}
                              to={link.to}
                              params={link.params}
                              className={`${styles.revisionItem} ${styles[`status-${item.status}`]}`}
                            >
                              {content}
                            </Link>
                          ) : (
                            <div
                              key={`${item.type}-${item.id}`}
                              className={`${styles.revisionItem} ${styles[`status-${item.status}`]}`}
                            >
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className={styles.detailsActions}>
                  <button className="btn-primary" onClick={handlePlanDay}>
                    Otevřít v Plánovači
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.scheduledDot}`} />
          <span>Naplánováno</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.overdueDot}`} />
          <span>Po termínu</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendInline}>Revize / Návštěvy / Follow-up</span>
        </div>
      </div>
    </div>
  );
}
