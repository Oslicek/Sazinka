import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
import { listRevisions, type Revision } from '../services/revisionService';
import styles from './TechnicianDay.module.css';

// Mock user ID for now
const USER_ID = '00000000-0000-0000-0000-000000000001';

interface StopWithDetails extends Revision {
  customerName?: string;
  customerPhone?: string;
  customerStreet?: string;
  customerCity?: string;
  customerPostalCode?: string;
  deviceName?: string;
  deviceType?: string;
}

export function TechnicianDay() {
  const isConnected = useNatsStore((s) => s.isConnected);
  const [stops, setStops] = useState<StopWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  const loadStops = useCallback(async () => {
    if (!isConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await listRevisions(USER_ID, {
        fromDate: selectedDate,
        toDate: selectedDate,
        dateType: 'scheduled',
        limit: 50,
      });
      
      // Sort by scheduled time
      const sorted = response.items.sort((a, b) => {
        if (!a.scheduledTimeStart && !b.scheduledTimeStart) return 0;
        if (!a.scheduledTimeStart) return 1;
        if (!b.scheduledTimeStart) return -1;
        return a.scheduledTimeStart.localeCompare(b.scheduledTimeStart);
      });
      
      setStops(sorted as StopWithDetails[]);
    } catch (err) {
      console.error('Failed to load stops:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zastávky');
    } finally {
      setLoading(false);
    }
  }, [isConnected, selectedDate]);

  useEffect(() => {
    loadStops();
  }, [loadStops]);

  const formatTime = (time: string | null | undefined) => {
    if (!time) return '-';
    return time.substring(0, 5);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    const dayName = days[date.getDay()];
    return `${dayName} ${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
  };

  const openNavigation = (stop: StopWithDetails) => {
    const address = `${stop.customerStreet || ''}, ${stop.customerCity || ''} ${stop.customerPostalCode || ''}`.trim();
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`, '_blank');
  };

  const callCustomer = (phone: string) => {
    window.location.href = `tel:${phone}`;
  };

  const generateGoogleMapsRoute = () => {
    if (stops.length === 0) return;
    
    // Google Maps supports up to ~10 waypoints
    const maxWaypoints = 9;
    const waypoints = stops.slice(0, maxWaypoints).map(stop => {
      const address = `${stop.customerStreet || ''}, ${stop.customerCity || ''} ${stop.customerPostalCode || ''}`.trim();
      return encodeURIComponent(address);
    });
    
    if (waypoints.length === 0) return;
    
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const waypointsParam = waypoints.length > 2 
      ? waypoints.slice(1, -1).join('|') 
      : '';
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypointsParam) {
      url += `&waypoints=${waypointsParam}`;
    }
    url += '&travelmode=driving';
    
    window.open(url, '_blank');
  };

  const generateSegmentedRoutes = () => {
    if (stops.length === 0) return [];
    
    const segmentSize = 8;
    const segments: { name: string; url: string }[] = [];
    
    for (let i = 0; i < stops.length; i += segmentSize) {
      const segment = stops.slice(i, i + segmentSize);
      const waypoints = segment.map(stop => {
        const address = `${stop.customerStreet || ''}, ${stop.customerCity || ''} ${stop.customerPostalCode || ''}`.trim();
        return encodeURIComponent(address);
      });
      
      if (waypoints.length === 0) continue;
      
      const origin = waypoints[0];
      const destination = waypoints[waypoints.length - 1];
      const waypointsParam = waypoints.length > 2 
        ? waypoints.slice(1, -1).join('|') 
        : '';
      
      let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
      if (waypointsParam) {
        url += `&waypoints=${waypointsParam}`;
      }
      url += '&travelmode=driving';
      
      const segmentNumber = Math.floor(i / segmentSize) + 1;
      const totalSegments = Math.ceil(stops.length / segmentSize);
      segments.push({
        name: `Trasa ${segmentNumber}/${totalSegments}`,
        url,
      });
    }
    
    return segments;
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'completed': return styles.statusCompleted;
      case 'confirmed': return styles.statusConfirmed;
      case 'scheduled': return styles.statusScheduled;
      default: return '';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      upcoming: 'Čeká',
      scheduled: 'Naplánováno',
      confirmed: 'Potvrzeno',
      completed: 'Hotovo',
      cancelled: 'Zrušeno',
    };
    return labels[status] || status;
  };

  const completedCount = stops.filter(s => s.status === 'completed').length;
  const segments = generateSegmentedRoutes();

  const printDayPlan = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Plán dne - ${formatDate(selectedDate)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { font-size: 18px; margin-bottom: 5px; }
          .date { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f5f5f5; }
          .time { white-space: nowrap; }
          .phone { white-space: nowrap; }
          @media print {
            body { padding: 0; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>Plán dne</h1>
        <div class="date">${formatDate(selectedDate)}</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="time">Čas</th>
              <th>Zákazník</th>
              <th>Adresa</th>
              <th class="phone">Telefon</th>
              <th>Zařízení</th>
            </tr>
          </thead>
          <tbody>
            ${stops.map((stop, index) => `
              <tr>
                <td>${index + 1}</td>
                <td class="time">${formatTime(stop.scheduledTimeStart)}${stop.scheduledTimeEnd ? ` - ${formatTime(stop.scheduledTimeEnd)}` : ''}</td>
                <td>${stop.customerName || '-'}</td>
                <td>${stop.customerStreet || ''}${stop.customerCity ? `, ${stop.customerCity}` : ''}${stop.customerPostalCode ? ` ${stop.customerPostalCode}` : ''}</td>
                <td class="phone">${stop.customerPhone || '-'}</td>
                <td>${stop.deviceType || '-'}${stop.deviceName ? ` - ${stop.deviceName}` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Můj den</h1>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className={styles.dateInput}
        />
      </header>

      <div className={styles.dateInfo}>
        <span className={styles.dateLabel}>{formatDate(selectedDate)}</span>
        <span className={styles.progress}>
          {completedCount}/{stops.length} hotovo
        </span>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={loadStops}>Zkusit znovu</button>
        </div>
      )}

      {!isConnected && (
        <div className={styles.disconnected}>
          Připojování k serveru...
        </div>
      )}

      {/* Export buttons */}
      {stops.length > 0 && (
        <div className={styles.exportSection}>
          <div className={styles.exportRow}>
            {segments.length === 1 ? (
              <button 
                className={styles.exportButton}
                onClick={generateGoogleMapsRoute}
              >
                🗺️ Google Maps
              </button>
            ) : (
              <div className={styles.segmentButtons}>
                <span className={styles.segmentLabel}>Navigace:</span>
                {segments.map((segment, index) => (
                  <button
                    key={index}
                    className={styles.segmentButton}
                    onClick={() => window.open(segment.url, '_blank')}
                  >
                    {segment.name}
                  </button>
                ))}
              </div>
            )}
            <button 
              className={styles.printButton}
              onClick={printDayPlan}
            >
              🖨️ Tisk
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Načítám zastávky...</div>
      ) : stops.length === 0 ? (
        <div className={styles.empty}>
          <p>🎉 Na tento den nemáte naplánované žádné návštěvy.</p>
        </div>
      ) : (
        <ul className={styles.stopList}>
          {stops.map((stop, index) => (
            <li key={stop.id} className={`${styles.stopItem} ${getStatusClass(stop.status)}`}>
              <div className={styles.stopNumber}>{index + 1}</div>
              
              <div className={styles.stopContent}>
                <div className={styles.stopHeader}>
                  <span className={styles.timeWindow}>
                    {formatTime(stop.scheduledTimeStart)}
                    {stop.scheduledTimeEnd && ` - ${formatTime(stop.scheduledTimeEnd)}`}
                  </span>
                  <span className={`${styles.statusBadge} ${getStatusClass(stop.status)}`}>
                    {getStatusLabel(stop.status)}
                  </span>
                </div>
                
                <div className={styles.customerName}>
                  {stop.customerName || `Revize #${stop.id.substring(0, 8)}`}
                </div>
                
                <div className={styles.address}>
                  📍 {stop.customerStreet || 'Adresa neuvedena'}
                  {stop.customerCity && `, ${stop.customerCity}`}
                  {stop.customerPostalCode && ` ${stop.customerPostalCode}`}
                </div>
                
                {stop.deviceType && (
                  <div className={styles.device}>
                    🔧 {stop.deviceType} {stop.deviceName && `- ${stop.deviceName}`}
                  </div>
                )}
                
                {stop.durationMinutes && (
                  <div className={styles.duration}>
                    ⏱️ ~{stop.durationMinutes} min
                  </div>
                )}
              </div>
              
              <div className={styles.stopActions}>
                <button
                  className={styles.actionButton}
                  onClick={() => openNavigation(stop)}
                  title="Navigovat"
                >
                  🧭
                </button>
                {stop.customerPhone && (
                  <button
                    className={styles.actionButton}
                    onClick={() => callCustomer(stop.customerPhone!)}
                    title="Zavolat"
                  >
                    📞
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.footer}>
        <button className={styles.refreshButton} onClick={loadStops} disabled={loading}>
          ↻ Obnovit
        </button>
      </div>
    </div>
  );
}
