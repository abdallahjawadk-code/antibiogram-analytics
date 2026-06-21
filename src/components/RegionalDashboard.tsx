import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getOrganisms, createHospital, insertAntibiogramData, getHospitalByCode } from '../lib/supabase';
import { Hospital, AntibiogramData } from '../types/database';
import { computeSIR } from '../lib/clinical';
import { getAntibioticClass, calculateMDR } from '../lib/stats';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Building2, Microscope, Globe, Activity, ShieldAlert, Sparkles, Filter, RefreshCw, Network } from 'lucide-react';
import { buildHospitalVectors, kMeans, ClusterResult } from '../lib/clustering';
import { ChartExportActions } from './ChartExportActions';

const HOTSPOT_RESISTANCE_DELTA = 15;
const HIGH_SUPERBUG_MIN_RESISTANT_ISOLATES = 3;
const HIGH_SUPERBUG_RATE = 5;

type SuperbugSignal = {
  type: 'CRE' | 'VRSA';
  organism: string;
  antibiotic: string;
  resistantIsolates: number;
  totalTested: number;
  resistanceRate: number;
};

export function RegionalDashboard() {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [organisms, setOrganisms] = useState<string[]>([]);
  const [antibiotics, setAntibiotics] = useState<string[]>([]);
  const [antibiogramData, setAntibiogramData] = useState<AntibiogramData[]>([]);
  const [selectedOrganism, setSelectedOrganism] = useState<string>('all');
  const [selectedAntibiotic, setSelectedAntibiotic] = useState<string>('all');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [enableHotspots, setEnableHotspots] = useState(false);
  const [clusterSeed, setClusterSeed] = useState(0);
  const [clusters, setClusters] = useState<ClusterResult[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [hospitalsData, organismsData, rawData] = await Promise.all([
          getHospitals(),
          getOrganisms(),
          getAntibiogramData({}),
        ]);
        setHospitals(hospitalsData);
        setOrganisms(organismsData);
        setAntibiogramData(rawData);

        // Derive unique antibiotics
        if (rawData.length > 0) {
          const uniqueAbs = [...new Set(rawData.map((d) => d.antibiotic))].sort();
          setAntibiotics(uniqueAbs);
        }

        // K-means clustering
        if (hospitalsData.length >= 2 && rawData.length > 0) {
          const nameMap: Record<string, string> = {};
          hospitalsData.forEach((h) => { nameMap[h.id] = h.name; });
          const vectors = buildHospitalVectors(rawData, nameMap);
          if (vectors.length >= 2) setClusters(kMeans(vectors, Math.min(3, vectors.length)));
        }
      } catch (error) {
        console.error('Error loading regional dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSeedDemoData = async () => {
    setSeeding(true);
    try {
      // 1. Create Iraqi Hospitals representing key regions
      const iraqiHospitals: Omit<Hospital, 'id' | 'created_at' | 'updated_at'>[] = [
        { name: 'Baghdad Medical City', code: 'HOSP_BGD', city: 'Baghdad', country: 'Iraq', hospital_type: 'teaching', is_active: true },
        { name: 'Basra General Hospital', code: 'HOSP_BSR', city: 'Basra', country: 'Iraq', hospital_type: 'government', is_active: true },
        { name: 'Al-Salam Teaching Hospital, Nineveh', code: 'HOSP_MSL', city: 'Nineveh', country: 'Iraq', hospital_type: 'teaching', is_active: true },
        { name: 'Erbil West Eye & General Hospital', code: 'HOSP_EBL', city: 'Erbil', country: 'Iraq', hospital_type: 'government', is_active: true },
        { name: 'Ramadi General Hospital, Anbar', code: 'HOSP_ANB', city: 'Anbar', country: 'Iraq', hospital_type: 'government', is_active: true },
        { name: 'Merjan Medical City', code: 'HOSP_BBL1', city: 'Babil', country: 'Iraq', hospital_type: 'teaching', is_active: true },
        { name: 'Al-Hillah Teaching Hospital', code: 'HOSP_BBL2', city: 'Babil', country: 'Iraq', hospital_type: 'teaching', is_active: true },
        { name: 'Al-Imam Sadiq Hospital', code: 'HOSP_BBL3', city: 'Babil', country: 'Iraq', hospital_type: 'government', is_active: true },
        { name: 'Al-Musayyib General Hospital', code: 'HOSP_BBL4', city: 'Babil', country: 'Iraq', hospital_type: 'government', is_active: true },
      ];
      
      const createdHospitals = [];
      for (const h of iraqiHospitals) {
        // Query the database directly to check if the hospital code exists,
        // avoiding local stale state issues.
        const existingDb = await getHospitalByCode(h.code);

        if (existingDb) {
          createdHospitals.push(existingDb);
        } else {
          try {
            const newH = await createHospital(h);
            createdHospitals.push(newH);
          } catch (insertErr) {
            // Fallback: If it failed due to a race condition (e.g. duplicate key), query it again.
            const retryDb = await getHospitalByCode(h.code);
            if (retryDb) {
              createdHospitals.push(retryDb);
            } else {
              throw insertErr;
            }
          }
        }
      }
      
      // 2. Generate Antibiogram Data
      const antibioticsList = [
        'Ampicillin', 'Ceftriaxone', 'Meropenem', 'Gentamicin', 'Ciprofloxacin',
        'Piperacillin-Tazobactam', 'Vancomycin', 'Linezolid', 'Trimethoprim-Sulfamethoxazole'
      ];
      
      const antibiogramRecords: Omit<AntibiogramData, 'id' | 'created_at' | 'upload_date'>[] = [];
      
      // Seed overall susceptibility levels per city
      const citySusceptibilityModifiers: Record<string, number> = {
        'Baghdad': 72,
        'Basra': 54,
        'Mosul': 85,
        'Erbil': 81,
        'Anbar': 65,
      };
      
      createdHospitals.forEach((h) => {
        const city = h.city || (isRTL ? 'غير محدد' : 'Unknown');
        const modifier = citySusceptibilityModifiers[city] || 70;
        const isolateCount = 40;
        
        for (let i = 1; i <= isolateCount; i++) {
          const patientId = `PT-${city.substring(0, 3).toUpperCase()}-${1000 + i}`;
          
          // Distribution of pathogens
          const rand = Math.random();
          let org = 'E. coli';
          if (rand > 0.85) org = 'S. aureus';
          else if (rand > 0.7) org = 'P. aeruginosa';
          else if (rand > 0.4) org = 'K. pneumoniae';
          
          // MDR Probability: high in Basra, low in Mosul
          const mdrProb = city === 'Basra' ? 0.42 : (city === 'Mosul' ? 0.08 : 0.22);
          const isMDRIsolate = Math.random() < mdrProb;
          
          const resistantClasses = new Set<string>();
          if (isMDRIsolate) {
            resistantClasses.add('Penicillins');
            resistantClasses.add('Cephalosporins');
            resistantClasses.add('Fluoroquinolones');
            if (Math.random() < 0.6) resistantClasses.add('Aminoglycosides');
          } else {
            const numResistantClasses = Math.random() < 0.5 ? 0 : (Math.random() < 0.85 ? 1 : 2);
            const classes = ['Penicillins', 'Cephalosporins', 'Fluoroquinolones', 'Aminoglycosides', 'Carbapenems'];
            for (let c = 0; c < numResistantClasses; c++) {
              const randomClass = classes[Math.floor(Math.random() * classes.length)];
              resistantClasses.add(randomClass);
            }
          }
          
          // Test a subset of antibiotics
          const abxsToTest = [...antibioticsList];
          abxsToTest.sort(() => Math.random() - 0.5);
          const selectedAbxs = abxsToTest.slice(0, 6);
          
          selectedAbxs.forEach((ab) => {
            const className = getAntibioticClass(ab);
            const isResistant = className ? resistantClasses.has(className) : false;
            
            let sCount = 0;
            let rCount = 0;
            const iCount = 0;
            
            if (isResistant) {
              rCount = 1;
            } else {
              const baseSusceptibility = ab === 'Meropenem' ? 95 : (ab === 'Ceftriaxone' ? 70 : 80);
              const finalSus = Math.min(99, baseSusceptibility * (modifier / 75));
              if (Math.random() * 100 < finalSus) {
                sCount = 1;
              } else {
                rCount = 1;
              }
            }
            
            antibiogramRecords.push({
              hospital_id: h.id,
              organism: org,
              antibiotic: ab,
              susceptible_count: sCount,
              intermediate_count: iCount,
              resistant_count: rCount,
              total_tested: 1,
              susceptible_percent: sCount * 100,
              year: 2026,
              period: 'annual',
              standard: 'CLSI',
              specimen_type: Math.random() < 0.7 ? 'Urine' : 'Blood',
              patient_id: patientId
            });
          });
        }
      });
      
      // Attempt insert; fallback to stripping new columns one by one
      // if they don't exist in the database schema yet.
      try {
        await insertAntibiogramData(antibiogramRecords);
      } catch (dbErr: unknown) {
        console.warn('Failed to insert with new schema, trying fallback without patient_id...', dbErr);
        try {
          const stripped = antibiogramRecords.map((record) => {
            const copy = { ...record };
            delete copy.patient_id;
            return copy;
          });
          await insertAntibiogramData(stripped);
        } catch (fallback1Err: unknown) {
          console.warn('Failed to insert without patient_id, trying fallback without any new columns...', fallback1Err);
          try {
            // Strip patient_id, mic_distribution, and specimen_type in case they are all missing in the DB schema
            const strippedAll = antibiogramRecords.map((record) => {
              const copy = { ...record };
              delete copy.patient_id;
              delete copy.mic_distribution;
              delete copy.specimen_type;
              return copy;
            });
            await insertAntibiogramData(strippedAll);
          } catch (fallback2Err: unknown) {
            console.error('All fallback insertions failed:', fallback2Err);
            throw fallback2Err;
          }
        }
      }
      
      // Reload page to display seeded data
      window.location.reload();
    } catch (error: unknown) {
      console.error('Failed to seed demo data:', error);
      const errorMsg = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? JSON.stringify(error)
          : String(error);
      alert('Error seeding demo data: ' + errorMsg);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  // Arabic display names for all 18 governorates + fallback
  const regionArabicName: Record<string, string> = {
    Nineveh: 'نينوى', Duhok: 'دهوك', Erbil: 'أربيل', Sulaymaniyah: 'السليمانية',
    Kirkuk: 'كركوك', Saladin: 'صلاح الدين', Diyala: 'ديالى', Anbar: 'الأنبار',
    Baghdad: 'بغداد', Wasit: 'واسط', Karbala: 'كربلاء', Babil: 'بابل',
    Qadisiyya: 'القادسية', Najaf: 'النجف', Muthanna: 'المثنى',
    DhiQar: 'ذي قار', Maysan: 'ميسان', Basra: 'البصرة',
  };
  const arName = (id: string) => regionArabicName[id] ?? id;

  // Geographic region parsing & mapping — all 18 Iraqi governorates
  const standardRegionsList = [
    'Nineveh', 'Duhok', 'Erbil', 'Sulaymaniyah', 'Kirkuk',
    'Saladin', 'Diyala', 'Anbar',
    'Baghdad', 'Wasit', 'Karbala', 'Babil',
    'Qadisiyya', 'Najaf', 'Muthanna', 'DhiQar', 'Maysan',
    'Basra',
  ];
  const allRegions = Array.from(new Set(hospitals.map(h => h.city?.trim()).filter(Boolean))) as string[];
  const regionOptions = [...new Set([...standardRegionsList, ...allRegions])].sort();

  function getStandardRegion(city: string | undefined): string {
    if (!city) return isRTL ? 'منطقة أخرى' : 'Other Region';
    const c = city.trim().toLowerCase();
    if (c.includes('baghdad') || c.includes('بغداد')) return 'Baghdad';
    if (c.includes('basra') || c.includes('البصرة') || c.includes('بصرة')) return 'Basra';
    if (c.includes('mosul') || c.includes('الموصل') || c.includes('موصل') || c.includes('nineveh') || c.includes('نينوى')) return 'Nineveh';
    if (c.includes('erbil') || c.includes('أربيل') || c.includes('اربيل') || c.includes('hawler')) return 'Erbil';
    if (c.includes('anbar') || c.includes('الأنبار') || c.includes('الانبار') || c.includes('ramadi') || c.includes('fallujah')) return 'Anbar';
    if (c.includes('babil') || c.includes('babylon') || c.includes('بابل') || c.includes('الحلة') || c.includes('hillah') || c.includes('hilla')) return 'Babil';
    if (c.includes('duhok') || c.includes('دهوك')) return 'Duhok';
    if (c.includes('sulaymaniyah') || c.includes('sulaimaniya') || c.includes('السليمانية')) return 'Sulaymaniyah';
    if (c.includes('kirkuk') || c.includes('كركوك')) return 'Kirkuk';
    if (c.includes('saladin') || c.includes('صلاح الدين') || c.includes('tikrit') || c.includes('تكريت')) return 'Saladin';
    if (c.includes('diyala') || c.includes('ديالى') || c.includes('baquba') || c.includes('بعقوبة')) return 'Diyala';
    if (c.includes('wasit') || c.includes('واسط') || c.includes('kut') || c.includes('الكوت')) return 'Wasit';
    if (c.includes('karbala') || c.includes('كربلاء')) return 'Karbala';
    if (c.includes('qadisiyya') || c.includes('qadisiya') || c.includes('القادسية') || c.includes('diwaniyah') || c.includes('الديوانية')) return 'Qadisiyya';
    if (c.includes('najaf') || c.includes('النجف')) return 'Najaf';
    if (c.includes('muthanna') || c.includes('المثنى') || c.includes('samawah') || c.includes('السماوة')) return 'Muthanna';
    if (c.includes('dhi qar') || c.includes('dhiqar') || c.includes('ذي قار') || c.includes('nasiriyah') || c.includes('الناصرية')) return 'DhiQar';
    if (c.includes('maysan') || c.includes('ميسان') || c.includes('amara') || c.includes('العمارة')) return 'Maysan';
    return city.trim();
  }

  // Create a map from hospital ID to region
  const hospitalRegionMap = new Map<string, string>();
  hospitals.forEach((h) => {
    const region = getStandardRegion(h.city);
    hospitalRegionMap.set(h.id, region);
  });

  // Calculate overall metrics per region
  const regionStatsMap = new Map<string, { hospitalIds: Set<string>; totalIsolates: number }>();
  antibiogramData.forEach((d) => {
    const region = hospitalRegionMap.get(d.hospital_id) || (isRTL ? 'منطقة أخرى' : 'Other Region');
    let stats = regionStatsMap.get(region);
    if (!stats) {
      stats = { hospitalIds: new Set(), totalIsolates: 0 };
      regionStatsMap.set(region, stats);
    }
    stats.hospitalIds.add(d.hospital_id);
    stats.totalIsolates += d.total_tested;
  });

  // Dynamic filter state calculations
  const totalRegions = regionStatsMap.size;
  const filteredHospitals = selectedRegion === 'all'
    ? hospitals
    : hospitals.filter(h => getStandardRegion(h.city) === selectedRegion);

  const filteredHospitalIds = new Set(filteredHospitals.map(h => h.id));
  const regionRows = antibiogramData.filter(d => filteredHospitalIds.has(d.hospital_id));

  // Calculate current total isolates (filtered by selected organism/antibiotic)
  const currentTotalIsolates = regionRows.reduce((sum, r) => {
    if (selectedOrganism !== 'all' && r.organism !== selectedOrganism) return sum;
    if (selectedAntibiotic !== 'all' && r.antibiotic !== selectedAntibiotic) return sum;
    return sum + r.total_tested;
  }, 0);

  // Calculate average resistance rate
  const matchedRowsForAvg = regionRows.filter(r => {
    if (selectedOrganism !== 'all' && r.organism !== selectedOrganism) return false;
    if (selectedAntibiotic !== 'all' && r.antibiotic !== selectedAntibiotic) return false;
    return true;
  });

  let avgSusceptibility = 0;
  if (matchedRowsForAvg.length > 0) {
    const totalTested = matchedRowsForAvg.reduce((sum, r) => sum + computeSIR(r).total, 0);
    const totalS = matchedRowsForAvg.reduce((sum, r) => {
      const sir = computeSIR(r);
      return sum + (sir.susceptible / 100) * sir.total;
    }, 0);
    avgSusceptibility = totalTested > 0 ? (totalS / totalTested) * 100 : 0;
  }
  const avgResistance = avgSusceptibility > 0 ? 100 - avgSusceptibility : 0;

  // MDR calculation (based on selected organism)
  const mdrRows = regionRows.filter(r => {
    if (selectedOrganism !== 'all' && r.organism !== selectedOrganism) return false;
    return true;
  });
  const mdrRate = calculateMDR(mdrRows);

  // SVG Map dynamic susceptibility calculations
  const mapRegionData: Record<string, { susceptibility: number; isolates: number }> = {};
  standardRegionsList.forEach((reg) => {
    const regHospitals = hospitals.filter(h => getStandardRegion(h.city) === reg);
    const regHospitalIds = new Set(regHospitals.map(h => h.id));
    const matchedRows = antibiogramData.filter((d) => {
      if (!regHospitalIds.has(d.hospital_id)) return false;
      if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
      if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
      return true;
    });

    let totalTested = 0;
    let totalS = 0;
    matchedRows.forEach((r) => {
      const sir = computeSIR(r);
      totalTested += sir.total;
      totalS += (sir.susceptible / 100) * sir.total;
    });

    if (totalTested > 0) {
      mapRegionData[reg] = {
        susceptibility: Math.round((totalS / totalTested) * 1000) / 10,
        isolates: totalTested,
      };
    }
  });

  function getRegionColor(susceptibility: number | undefined) {
    if (susceptibility === undefined) return '#f1f5f9'; // Slate 100 for no data
    if (susceptibility >= 80) return '#10b981'; // Emerald (good)
    if (susceptibility >= 60) return '#f59e0b'; // Amber (moderate)
    return '#f43f5e'; // Rose (poor)
  }

  // 1. Calculate national average susceptibility/resistance under selected organism/antibiotic filters
  const nationalMatchedRows = antibiogramData.filter(d => {
    if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
    if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
    return true;
  });

  let nationalAvgResistance = 0;
  let nationalTotalTested = 0;
  if (nationalMatchedRows.length > 0) {
    const totals = nationalMatchedRows.reduce((sum, r) => {
      const sir = computeSIR(r);
      sum.tested += sir.total;
      sum.resistant += (sir.resistant / 100) * sir.total;
      return sum;
    }, { tested: 0, resistant: 0 });
    nationalTotalTested = totals.tested;
    nationalAvgResistance = nationalTotalTested > 0
      ? (totals.resistant / nationalTotalTested) * 100
      : 0;
  }

  // Helper functions for superbug detection
  function isEnterobacterales(organism: string): boolean {
    const org = organism.toLowerCase();
    return org.includes('coli') ||
           org.includes('klebsiella') ||
           org.includes('pneumoniae') ||
           org.includes('enterobacter') ||
           org.includes('serratia') ||
           org.includes('proteus') ||
           org.includes('salmonella') ||
           org.includes('enterobacterales');
  }

  function isCarbapenem(antibiotic: string): boolean {
    const ab = antibiotic.toLowerCase();
    return ab.includes('meropenem') || ab.includes('imipenem') || ab.includes('ertapenem');
  }

  function isSAureus(organism: string): boolean {
    const org = organism.toLowerCase();
    return org.includes('aureus') || org.includes('staph');
  }

  function isVancomycin(antibiotic: string): boolean {
    return antibiotic.toLowerCase().includes('vancomycin');
  }

  function checkSuperbug(r: AntibiogramData): { isSuperbug: boolean; type?: 'CRE' | 'VRSA' } {
    const sir = computeSIR(r);
    const resistantCount = (sir.resistant / 100) * sir.total;
    const hasResistance = resistantCount > 0;
    if (!hasResistance) {
      return { isSuperbug: false };
    }

    if (isEnterobacterales(r.organism) && isCarbapenem(r.antibiotic)) {
      return {
        isSuperbug: true,
        type: 'CRE',
      };
    }

    if (isSAureus(r.organism) && isVancomycin(r.antibiotic)) {
      return {
        isSuperbug: true,
        type: 'VRSA',
      };
    }

    return { isSuperbug: false };
  }

  const getRegionRecords = (regionId: string) => {
    const regHospitals = hospitals.filter(h => getStandardRegion(h.city) === regionId);
    const regHospitalIds = new Set(regHospitals.map(h => h.id));
    return antibiogramData.filter(d => regHospitalIds.has(d.hospital_id));
  };

  const getRegionAvgResistance = (regionId: string) => {
    const records = getRegionRecords(regionId).filter((d) => {
      if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
      if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
      return true;
    });

    let totalTested = 0;
    let totalR = 0;
    records.forEach((r) => {
      const sir = computeSIR(r);
      totalTested += sir.total;
      totalR += (sir.resistant / 100) * sir.total;
    });

    const avgR = totalTested > 0 ? (totalR / totalTested) * 100 : 0;
    return { avgResistance: avgR, totalTested };
  };

  const getRegionSuperbugs = (regionId: string): SuperbugSignal[] => {
    const signals = new Map<string, Omit<SuperbugSignal, 'resistanceRate'>>();
    const records = getRegionRecords(regionId).filter((d) => {
      if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
      if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
      return true;
    });

    records.forEach((r) => {
      const check = checkSuperbug(r);
      if (check.isSuperbug && check.type) {
        const key = `${check.type}||${r.organism.toLowerCase()}||${r.antibiotic.toLowerCase()}`;
        const previous = signals.get(key) || {
          type: check.type,
          organism: r.organism,
          antibiotic: r.antibiotic,
          resistantIsolates: 0,
          totalTested: 0,
        };
        const sir = computeSIR(r);
        previous.resistantIsolates += (sir.resistant / 100) * sir.total;
        previous.totalTested += sir.total;
        signals.set(key, previous);
      }
    });

    return Array.from(signals.values())
      .map((signal) => ({
        ...signal,
        resistanceRate: signal.totalTested > 0
          ? (signal.resistantIsolates / signal.totalTested) * 100
          : 0,
      }))
      .filter((signal) =>
        signal.resistantIsolates >= HIGH_SUPERBUG_MIN_RESISTANT_ISOLATES &&
        signal.resistanceRate >= HIGH_SUPERBUG_RATE,
      )
      .sort((a, b) => b.resistanceRate - a.resistanceRate || b.resistantIsolates - a.resistantIsolates)
      .slice(0, 10);
  };

  const hotspotsList: {
    regionId: string;
    nameEn: string;
    nameAr: string;
    avgResistance: number;
    nationalAvgResistance: number;
    diff: number;
    superbugs: SuperbugSignal[];
    reason: 'rate' | 'superbug' | 'both';
  }[] = [];

  if (enableHotspots) {
    const targetRegions = [
      { id: 'Anbar', nameEn: 'Anbar', nameAr: 'الأنبار' },
      { id: 'Mosul', nameEn: 'Mosul', nameAr: 'الموصل' },
      { id: 'Erbil', nameEn: 'Erbil', nameAr: 'أربيل' },
      { id: 'Baghdad', nameEn: 'Baghdad', nameAr: 'بغداد' },
      { id: 'Basra', nameEn: 'Basra', nameAr: 'البصرة' }
    ];

    targetRegions.forEach((r) => {
      const { avgResistance: regR, totalTested } = getRegionAvgResistance(r.id);
      const superbugs = getRegionSuperbugs(r.id);
      const diff = regR - nationalAvgResistance;
      const exceedsRate = totalTested > 0 && diff >= HOTSPOT_RESISTANCE_DELTA;
      const hasSuperbug = superbugs.length > 0;

      if (exceedsRate || hasSuperbug) {
        hotspotsList.push({
          regionId: r.id,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          avgResistance: Math.round(regR * 10) / 10,
          nationalAvgResistance: Math.round(nationalAvgResistance * 10) / 10,
          diff: Math.round(diff * 10) / 10,
          superbugs,
          reason: exceedsRate && hasSuperbug ? 'both' : exceedsRate ? 'rate' : 'superbug'
        });
      }
    });
  }

  // Simple string helper to format messages
  function formatMessage(template: string, vars: Record<string, string | number>): string {
    let result = template;
    Object.entries(vars).forEach(([key, val]) => {
      result = result.split(`{${key}}`).join(String(val));
    });
    return result;
  }

  // Complete Iraq SVG map — all 18 governorates (viewBox 0 0 480 520)
  const regions = [
    // ── Northern / Kurdistan ──────────────────────────────────────────────────
    { id: 'Nineveh',      nameEn: 'Nineveh',      nameAr: 'نينوى',         path: 'M 15,28 L 128,10 L 200,62 L 196,130 L 98,132 L 15,78 Z',                   labelX: 92,  labelY: 80  },
    { id: 'Duhok',        nameEn: 'Duhok',         nameAr: 'دهوك',          path: 'M 128,10 L 196,10 L 204,60 L 200,62 Z',                                     labelX: 167, labelY: 36  },
    { id: 'Erbil',        nameEn: 'Erbil',         nameAr: 'أربيل',         path: 'M 196,10 L 283,12 L 288,67 L 204,60 Z',                                     labelX: 243, labelY: 40  },
    { id: 'Sulaymaniyah', nameEn: 'Sulaymaniyah',  nameAr: 'السليمانية',    path: 'M 283,12 L 396,25 L 390,118 L 318,122 L 288,67 Z',                          labelX: 340, labelY: 72  },
    { id: 'Kirkuk',       nameEn: 'Kirkuk',        nameAr: 'كركوك',         path: 'M 204,60 L 288,67 L 318,122 L 246,130 L 204,100 Z',                         labelX: 258, labelY: 98  },
    // ── Upper-middle ──────────────────────────────────────────────────────────
    { id: 'Saladin',      nameEn: 'Saladin',       nameAr: 'صلاح الدين',    path: 'M 98,132 L 196,130 L 246,130 L 240,202 L 150,208 L 100,188 Z',              labelX: 172, labelY: 168 },
    { id: 'Diyala',       nameEn: 'Diyala',        nameAr: 'ديالى',         path: 'M 246,130 L 318,122 L 390,118 L 384,205 L 290,215 L 240,202 Z',             labelX: 318, labelY: 165 },
    // ── Anbar (western desert, spans full height) ─────────────────────────────
    { id: 'Anbar',        nameEn: 'Anbar',         nameAr: 'الأنبار',       path: 'M 15,78 L 98,132 L 100,188 L 150,208 L 145,302 L 150,378 L 15,378 Z',       labelX: 76,  labelY: 250 },
    // ── Middle ────────────────────────────────────────────────────────────────
    { id: 'Baghdad',      nameEn: 'Baghdad',       nameAr: 'بغداد',         path: 'M 150,208 L 240,202 L 246,262 L 184,272 L 148,248 Z',                       labelX: 198, labelY: 238 },
    { id: 'Wasit',        nameEn: 'Wasit',         nameAr: 'واسط',          path: 'M 240,202 L 290,215 L 384,205 L 378,305 L 277,316 L 225,283 Z',             labelX: 308, labelY: 260 },
    { id: 'Karbala',      nameEn: 'Karbala',       nameAr: 'كربلاء',        path: 'M 148,248 L 184,272 L 178,328 L 148,335 L 130,288 Z',                       labelX: 156, labelY: 298 },
    { id: 'Babil',        nameEn: 'Babil',         nameAr: 'بابل',          path: 'M 184,272 L 246,262 L 240,312 L 198,325 L 178,328 Z',                       labelX: 213, labelY: 300 },
    // ── Lower-middle ──────────────────────────────────────────────────────────
    { id: 'Qadisiyya',    nameEn: 'Qadisiyya',    nameAr: 'القادسية',      path: 'M 148,335 L 178,328 L 198,325 L 240,312 L 225,283 L 277,316 L 268,380 L 196,385 L 148,367 Z', labelX: 212, labelY: 352 },
    { id: 'DhiQar',       nameEn: 'Dhi Qar',      nameAr: 'ذي قار',        path: 'M 277,316 L 378,305 L 383,400 L 280,395 L 268,380 Z',                       labelX: 328, labelY: 358 },
    { id: 'Maysan',       nameEn: 'Maysan',        nameAr: 'ميسان',         path: 'M 378,305 L 384,205 L 462,215 L 460,400 L 383,400 Z',                       labelX: 420, labelY: 305 },
    // ── South ─────────────────────────────────────────────────────────────────
    { id: 'Najaf',        nameEn: 'Najaf',         nameAr: 'النجف',         path: 'M 150,378 L 196,385 L 188,448 L 150,448 Z',                                 labelX: 170, labelY: 415 },
    { id: 'Muthanna',     nameEn: 'Muthanna',      nameAr: 'المثنى',        path: 'M 196,385 L 268,380 L 280,395 L 276,450 L 188,448 Z',                       labelX: 234, labelY: 420 },
    { id: 'Basra',        nameEn: 'Basra',         nameAr: 'البصرة',        path: 'M 280,395 L 383,400 L 460,400 L 462,510 L 280,510 L 276,450 Z',             labelX: 370, labelY: 455 },
  ];

  const handleRegionClick = (regionId: string) => {
    if (selectedRegion === regionId) {
      setSelectedRegion('all');
    } else {
      setSelectedRegion(regionId);
    }
  };

  const resetAllFilters = () => {
    setSelectedRegion('all');
    setSelectedOrganism('all');
    setSelectedAntibiotic('all');
  };

  // Prepare chart & table data
  const chartData: { name: string; susceptibility: number; isolates: number; sites?: number }[] = [];

  if (selectedRegion === 'all') {
    const presentRegions = new Set<string>();
    hospitals.forEach(h => presentRegions.add(getStandardRegion(h.city)));

    presentRegions.forEach((reg) => {
      const regHospitals = hospitals.filter(h => getStandardRegion(h.city) === reg);
      const regHospitalIds = new Set(regHospitals.map(h => h.id));
      const matchedRows = antibiogramData.filter((d) => {
        if (!regHospitalIds.has(d.hospital_id)) return false;
        if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
        if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
        return true;
      });

      let totalTested = 0;
      let totalS = 0;
      matchedRows.forEach((r) => {
        const sir = computeSIR(r);
        totalTested += sir.total;
        totalS += (sir.susceptible / 100) * sir.total;
      });

      if (totalTested > 0) {
        chartData.push({
          name: reg,
          susceptibility: Math.round((totalS / totalTested) * 1000) / 10,
          isolates: totalTested,
          sites: regHospitals.length,
        });
      }
    });
  } else {
    // Drill down: group by individual hospitals in selected region
    const regHospitals = hospitals.filter(h => getStandardRegion(h.city) === selectedRegion);

    regHospitals.forEach((h) => {
      const matchedRows = antibiogramData.filter((d) => {
        if (d.hospital_id !== h.id) return false;
        if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
        if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
        return true;
      });

      let totalTested = 0;
      let totalS = 0;
      matchedRows.forEach((r) => {
        const sir = computeSIR(r);
        totalTested += sir.total;
        totalS += (sir.susceptible / 100) * sir.total;
      });

      if (totalTested > 0) {
        chartData.push({
          name: h.name,
          susceptibility: Math.round((totalS / totalTested) * 1000) / 10,
          isolates: totalTested,
          sites: 1,
        });
      }
    });
  }

  const BAR_COLORS = ['#0ea5e9', '#0d9488', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.regional.title}</h1>
          <p className="text-slate-500 mt-1">{t.regional.subtitle}</p>
        </div>
      </div>

      {/* Seeding Banner if empty */}
      {antibiogramData.length === 0 && (
        <div className="bg-gradient-to-r from-teal-500 to-emerald-600 rounded-3xl p-8 text-white shadow-lg flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <h2 className="text-xl font-bold flex items-center justify-center md:justify-start gap-2">
              <Sparkles className="w-5 h-5 animate-pulse" />
              {isRTL ? 'تحميل البيانات التجريبية للعراق' : 'Load Iraq Demo Data'}
            </h2>
            <p className="text-teal-50 opacity-90 max-w-2xl text-sm">
              {isRTL 
                ? 'لا توجد بيانات مراقبة إقليمية حالياً. اضغط على الزر أدناه لإنشاء وتنزيل بيانات محاكاة واقعية للمدن العراقية الكبرى (بغداد، البصرة، الموصل، أربيل، الأنبار) لتجربة الخريطة ومؤشرات المقاومة.' 
                : 'No regional surveillance data is currently available. Click below to load realistic simulated data for major Iraqi cities (Baghdad, Basra, Mosul, Erbil, Anbar) to preview the interactive map and MDR indicators.'}
            </p>
          </div>
          <button
            onClick={handleSeedDemoData}
            disabled={seeding}
            className="px-6 py-3.5 bg-white text-teal-700 font-bold rounded-2xl shadow-md hover:bg-teal-50 active:scale-95 transition-all duration-200 flex items-center gap-2 shrink-0 disabled:opacity-50"
          >
            {seeding ? (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-teal-700 border-t-transparent" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
            {isRTL ? 'تحميل البيانات التجريبية' : 'Load Demo Data'}
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        {/* Regions Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-600 shrink-0">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">
              {selectedRegion === 'all' 
                ? (isRTL ? 'المناطق الجغرافية' : 'Surveillance Regions')
                : (isRTL ? 'المنطقة المحددة' : 'Selected Region')}
            </p>
            <p className="text-xl font-bold text-slate-800 mt-1 truncate max-w-[130px]">
              {selectedRegion === 'all' 
                ? totalRegions 
                : (isRTL ? (arName(selectedRegion)) : selectedRegion)}
            </p>
          </div>
        </div>

        {/* Sites Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-600 shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">{t.regional.hospitalsCount}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{filteredHospitals.length}</p>
          </div>
        </div>

        {/* Isolates Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <Microscope className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">{t.regional.totalIsolates}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{currentTotalIsolates.toLocaleString()}</p>
          </div>
        </div>

        {/* Resistance Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">{t.regional.avgResistance}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">
              {currentTotalIsolates > 0 ? `${Math.round(avgResistance * 10) / 10}%` : '—'}
            </p>
          </div>
        </div>

        {/* MDR Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-semibold text-slate-400 truncate">{t.regional.mdrRate}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{mdrRate > 0 ? `${mdrRate}%` : '0%'}</p>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{t.regional.mdrSubtitle}</p>
          </div>
        </div>
      </div>

      {antibiogramData.length > 0 && (
        <>
          {/* Map and Filters Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Geographic Map Card */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Globe className="w-5 h-5 text-teal-600" />
                {t.regional.geographicMap}
              </h3>
              <div className="flex justify-center items-center py-4 bg-slate-50 rounded-2xl border border-slate-100 relative">
                <svg viewBox="0 0 480 520" className="w-full max-w-[400px] aspect-[480/520]">
                  <style>{`
                    @keyframes hotspot-pulse {
                      0%, 100% {
                        stroke: #ef4444;
                        stroke-width: 2.5px;
                        stroke-opacity: 0.8;
                      }
                      50% {
                        stroke: #b91c1c;
                        stroke-width: 4px;
                        stroke-opacity: 1;
                      }
                    }
                    .animate-hotspot-path {
                      animation: hotspot-pulse 1.5s infinite ease-in-out;
                    }
                    @keyframes ring-expand {
                      0% {
                        r: 8px;
                        opacity: 0.8;
                        stroke-width: 1.5px;
                      }
                      50% {
                        r: 20px;
                        opacity: 0.4;
                        stroke-width: 2.5px;
                      }
                      100% {
                        r: 32px;
                        opacity: 0;
                        stroke-width: 1px;
                      }
                    }
                    .animate-ring-expand {
                      animation: ring-expand 2s cubic-bezier(0.25, 0, 0, 1) infinite;
                    }
                    @keyframes dot-pulse {
                      0%, 100% {
                        transform: scale(1);
                      }
                      50% {
                        transform: scale(1.3);
                      }
                    }
                    .animate-dot-pulse {
                      animation: dot-pulse 1.5s infinite ease-in-out;
                    }
                  `}</style>
                  {regions.map((r) => {
                    const data = mapRegionData[r.id];
                    const name = isRTL ? r.nameAr : r.nameEn;
                    const sus = data?.susceptibility;
                    const isSelected = selectedRegion === r.id;
                    const isHotspot = enableHotspots && hotspotsList.some((h) => h.regionId === r.id);
                    const fillColor = getRegionColor(sus);
                    const strokeColor = isSelected ? '#0d9488' : '#ffffff';
                    const strokeWidth = isSelected ? 3 : 1.5;

                    return (
                      <g
                        key={r.id}
                        className="cursor-pointer group"
                        role="button"
                        tabIndex={0}
                        aria-label={`${name}${sus !== undefined ? `: ${Math.round(sus)}% susceptibility` : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => handleRegionClick(r.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleRegionClick(r.id);
                          }
                        }}
                      >
                        {/* Region path */}
                        <path
                          d={r.path}
                          fill={fillColor}
                          stroke={isHotspot ? undefined : strokeColor}
                          strokeWidth={isHotspot ? undefined : strokeWidth}
                          className={`transition-all duration-300 hover:opacity-95 hover:brightness-95 ${isHotspot ? 'animate-hotspot-path' : ''}`}
                        />
                        
                        {/* City indicator dot */}
                        <circle
                          cx={r.labelX}
                          cy={r.labelY}
                          r={isSelected ? 6 : 4}
                          fill={isHotspot ? '#ef4444' : (isSelected ? '#0d9488' : '#ffffff')}
                          stroke={isHotspot ? '#ffffff' : '#0f172a'}
                          strokeWidth={1.5}
                          className={`transition-all duration-300 group-hover:scale-125 ${isHotspot ? 'animate-dot-pulse' : ''}`}
                          style={{ transformOrigin: `${r.labelX}px ${r.labelY}px` }}
                        />

                        {/* Pulsing ring if selected (and not hotspot) */}
                        {isSelected && !isHotspot && (
                          <circle
                            cx={r.labelX}
                            cy={r.labelY}
                            r={12}
                            fill="none"
                            stroke="#0d9488"
                            strokeWidth={1.5}
                            className="animate-ping origin-center"
                            style={{ transformOrigin: `${r.labelX}px ${r.labelY}px` }}
                          />
                        )}

                        {/* Hotspot radar rings */}
                        {isHotspot && (
                          <>
                            <circle
                              cx={r.labelX}
                              cy={r.labelY}
                              r={12}
                              fill="none"
                              stroke="#ef4444"
                              className="animate-ring-expand"
                              style={{ transformOrigin: `${r.labelX}px ${r.labelY}px` }}
                            />
                            <circle
                              cx={r.labelX}
                              cy={r.labelY}
                              r={12}
                              fill="none"
                              stroke="#f87171"
                              className="animate-ring-expand"
                              style={{
                                transformOrigin: `${r.labelX}px ${r.labelY}px`,
                                animationDelay: '1s'
                              }}
                            />
                          </>
                        )}

                        {/* Label text */}
                        <text
                          x={r.labelX}
                          y={r.labelY - 12}
                          textAnchor="middle"
                          className="text-[11px] font-bold fill-slate-800 select-none pointer-events-none drop-shadow-sm font-sans"
                        >
                          {name} {sus !== undefined ? `(${sus}%)` : ''}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              
              {/* Map Legend */}
              <div className="flex flex-wrap gap-4 mt-6 text-xs text-slate-500 justify-center w-full border-t border-slate-100 pt-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 inline-block" />
                  <span>{isRTL ? 'حساسية عالية (>=80%)' : 'High Susceptibility (>=80%)'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-amber-500 inline-block" />
                  <span>{isRTL ? 'حساسية متوسطة (60-80%)' : 'Moderate (60-80%)'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-rose-500 inline-block" />
                  <span>{isRTL ? 'حساسية منخفضة (<60%)' : 'Low Susceptibility (<60%)'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-slate-200 border border-dashed border-slate-400 inline-block" />
                  <span>{isRTL ? 'لا توجد بيانات' : 'No Data'}</span>
                </div>
              </div>
            </div>

            {/* Controls / Hotspots Column */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              {/* Filter Controls Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-teal-600" />
                    {isRTL ? 'تصفية البيانات إقليمياً' : 'Filter Surveillance Data'}
                  </span>
                  {(selectedRegion !== 'all' || selectedOrganism !== 'all' || selectedAntibiotic !== 'all') && (
                    <button 
                      onClick={resetAllFilters}
                      className="text-xs text-teal-600 hover:text-teal-700 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {t.regional.resetFilter}
                    </button>
                  )}
                </h3>

                {/* Region Select */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">
                    {isRTL ? 'المنطقة الجغرافية' : 'Surveillance Region'}
                  </label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-colors"
                  >
                    <option value="all">{isRTL ? 'جميع المناطق' : 'All Regions'}</option>
                    {regionOptions.map((reg) => (
                      <option key={reg} value={reg}>
                        {isRTL ? (arName(reg)) : reg}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Organism Select */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">
                    {t.regional.selectOrganism}
                  </label>
                  <select
                    value={selectedOrganism}
                    onChange={(e) => setSelectedOrganism(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-colors"
                  >
                    <option value="all">{t.antibiogram.allOrganisms}</option>
                    {organisms.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>

                {/* Antibiotic Select */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">
                    {t.regional.selectAntibiotic}
                  </label>
                  <select
                    value={selectedAntibiotic}
                    onChange={(e) => setSelectedAntibiotic(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-colors"
                  >
                    <option value="all">{isRTL ? 'جميع المضادات' : 'All Antibiotics'}</option>
                    {antibiotics.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                {/* Hotspot Detector Toggle Switch */}
                <div className="border-t border-slate-100 pt-4 mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={`w-4 h-4 ${enableHotspots ? 'text-rose-500' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold text-slate-700">{t.hotspots.toggleLabel}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={enableHotspots}
                    onClick={() => setEnableHotspots(!enableHotspots)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      enableHotspots ? 'bg-rose-500' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        enableHotspots 
                          ? (isRTL ? '-translate-x-5' : 'translate-x-5') 
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Warning Banners / Success Banner */}
              {enableHotspots && (
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-4">
                  <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
                    {isRTL ? 'حالة كاشف البؤر الساخنة' : 'Hotspot Detector Status'}
                  </h3>
                  
                  {hotspotsList.length === 0 ? (
                    <div className="bg-emerald-50/80 border border-emerald-100 rounded-2xl p-4 text-emerald-950 flex items-center gap-3 animate-fade-in">
                      <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs">
                          {isRTL ? 'لا توجد بؤر تفشي نشطة' : 'No Active Hotspots'}
                        </h4>
                        <p className="text-[10px] text-emerald-700 mt-0.5 leading-normal">
                          {isRTL 
                            ? 'جميع المحافظات ضمن الحدود الطبيعية للمقاومة ولم يتم اكتشاف جراثيم فائقة.'
                            : 'All provinces are within normal resistance limits and no superbugs have been detected.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 scrollbar-hide">
                      {hotspotsList.map((hotspot) => {
                        const provinceName = isRTL ? hotspot.nameAr : hotspot.nameEn;
                        const rateDesc = formatMessage(t.hotspots.warningDesc, {
                          province: provinceName,
                          rate: hotspot.avgResistance,
                          diff: hotspot.diff,
                          avg: hotspot.nationalAvgResistance
                        });
                        const superbugDesc = formatMessage(t.hotspots.superbugWarning, {
                          province: provinceName
                        });

                        return (
                          <div 
                            key={hotspot.regionId}
                            className="bg-rose-50/80 border border-rose-100 rounded-2xl p-4 space-y-2 relative overflow-hidden animate-slide-up"
                          >
                            <div className={`absolute top-0 bottom-0 w-1 bg-rose-500 ${isRTL ? 'right-0' : 'left-0'}`} />
                            <div className={`flex items-start gap-2.5 ${isRTL ? 'pr-1' : 'pl-1'}`}>
                              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                              <div className="space-y-1.5 text-rose-950">
                                <h4 className="font-bold text-xs">
                                  {provinceName}
                                </h4>
                                
                                {(hotspot.reason === 'rate' || hotspot.reason === 'both') && (
                                  <p className="text-[11px] text-rose-800 leading-normal">
                                    {rateDesc}
                                  </p>
                                )}

                                {hotspot.superbugs.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-[11px] font-semibold text-rose-900 leading-normal">
                                      {superbugDesc}
                                    </p>
                                    <ul className="list-disc list-inside text-[10px] text-rose-700 space-y-0.5">
                                      {hotspot.superbugs.map((sb, idx) => (
                                        <li key={idx}>
                                          <span className="font-semibold">{sb.type}:</span> {sb.organism} / {sb.antibiotic}
                                          <span className="text-rose-600"> — {Math.round(sb.resistantIsolates)} {isRTL ? 'عزلات مقاومة' : 'resistant isolates'} ({sb.resistanceRate.toFixed(1)}%)</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Info Box (when hotspots not showing or just as footer) */}
              {!enableHotspots && (
                <div className="p-4 bg-teal-50/50 rounded-2xl border border-teal-100/50 space-y-2 text-sm text-teal-800">
                  <h4 className="font-bold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                    {isRTL ? 'إرشادات الاستخدام' : 'Dashboard Guide'}
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {isRTL 
                      ? 'انقر على أي منطقة في الخريطة الجغرافية لتصفية البيانات فوراً لتلك المدينة. يمكنك تصفية الكائنات الحية والمضادات لعرض معدلات الحساسية وحجم العينات المفصل.'
                      : 'Click any region on the geographic map to instantly filter the dashboard for that city. You can filter by pathogen and antibiotic to view tailored susceptibility and isolate volume.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Babil Governorate Hospitals Map ── */}
          {selectedRegion === 'Babil' && (() => {
            const babilHospitals = filteredHospitals;
            // Per-hospital susceptibility: average across all antibiogram rows for that hospital
            const hospSus: Record<string, number> = {};
            babilHospitals.forEach(h => {
              const rows = antibiogramData.filter(d => d.hospital_id === h.id);
              if (rows.length === 0) return;
              const totalS = rows.reduce((s, d) => s + (d.susceptible_count || 0), 0);
              const totalN = rows.reduce((s, d) => s + (d.total_tested || 0), 0);
              hospSus[h.id] = totalN > 0 ? (totalS / totalN) * 100 : -1;
            });

            // Approximate pin positions within Babil province mini-map (viewBox 300 200)
            const pinPositions = [
              { x: 150, y: 95  },  // Hillah center (capital)
              { x: 135, y: 48  },  // Al-Musayyib (north)
              { x: 200, y: 88  },  // Al-Mahawil (east)
              { x: 88,  y: 118 },  // Hashimiyah (west)
              { x: 160, y: 145 },  // Al-Qasim (south)
              { x: 82,  y: 150 },  // Afaq (south-west)
              { x: 210, y: 52  },  // Nile (north-east)
              { x: 170, y: 72  },  // Sadah
            ];

            const pinColor = (sus: number) => {
              if (sus < 0) return '#94a3b8';
              if (sus >= 80) return '#22c55e';
              if (sus >= 60) return '#f59e0b';
              return '#ef4444';
            };

            return (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-teal-100 flex items-center justify-center">
                    <Globe className="w-4 h-4 text-teal-600" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-800">
                    {isRTL ? 'خريطة مستشفيات محافظة بابل' : 'Babil Governorate Hospital Map'}
                  </h3>
                </div>
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* SVG mini-map */}
                  <div className="flex-1 min-w-0">
                    <svg viewBox="0 0 300 200" className="w-full max-w-sm mx-auto" style={{ height: 220 }}>
                      <defs>
                        <linearGradient id="babilBg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f0fdf4" />
                          <stop offset="100%" stopColor="#dcfce7" />
                        </linearGradient>
                      </defs>
                      {/* Province outline */}
                      <path d="M 50,15 L 255,15 L 265,185 L 45,185 Z" fill="url(#babilBg)" stroke="#86efac" strokeWidth="2" strokeLinejoin="round" />
                      {/* Euphrates river (schematic) */}
                      <path d="M 200,15 C 185,55 145,80 140,100 C 135,120 115,145 100,185"
                        fill="none" stroke="#93c5fd" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
                      <text x="218" y="80" fontSize="8" fill="#3b82f6" opacity="0.8" transform="rotate(-70,218,80)">نهر الفرات</text>
                      {/* District labels */}
                      <text x="150" y="12" textAnchor="middle" fontSize="9" fill="#16a34a" fontWeight="600">الحلة</text>
                      <text x="135" y="36" textAnchor="middle" fontSize="7.5" fill="#64748b">المسيب</text>
                      <text x="205" y="76" textAnchor="middle" fontSize="7.5" fill="#64748b">المحاويل</text>
                      <text x="82" y="108" textAnchor="middle" fontSize="7.5" fill="#64748b">الهاشمية</text>
                      <text x="160" y="162" textAnchor="middle" fontSize="7.5" fill="#64748b">القاسم</text>
                      {/* Hospital pins */}
                      {babilHospitals.map((h, i) => {
                        const pos = pinPositions[i % pinPositions.length];
                        const sus = hospSus[h.id] ?? -1;
                        const col = pinColor(sus);
                        const shortName = h.name.replace(/hospital|مستشفى|عام|general|teaching|medical/gi, '').trim().slice(0, 12);
                        return (
                          <g key={h.id}>
                            <circle cx={pos.x} cy={pos.y} r={8} fill={col} opacity={0.9} stroke="#fff" strokeWidth={2} />
                            <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">
                              {sus >= 0 ? Math.round(sus) : '?'}
                            </text>
                            <text x={pos.x} y={pos.y + 17} textAnchor="middle" fontSize="6.5" fill="#334155">
                              {shortName}
                            </text>
                          </g>
                        );
                      })}
                      {babilHospitals.length === 0 && (
                        <text x="150" y="100" textAnchor="middle" fontSize="10" fill="#94a3b8">
                          {isRTL ? 'لا توجد مستشفيات مسجلة' : 'No hospitals registered'}
                        </text>
                      )}
                    </svg>
                    {/* Legend */}
                    <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />{isRTL ? '≥80% حساسية' : '≥80% susceptibility'}</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />{isRTL ? '60-80%' : '60-80%'}</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" />{isRTL ? '<60%' : '<60%'}</span>
                    </div>
                  </div>
                  {/* Hospital list */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                      {isRTL ? 'المستشفيات المسجلة' : 'Registered Hospitals'} ({babilHospitals.length})
                    </p>
                    {babilHospitals.length === 0 ? (
                      <p className="text-sm text-slate-400">{isRTL ? 'ارفع ملف بيانات بابل لإظهار المستشفيات' : 'Upload a Babil data file to display hospitals'}</p>
                    ) : babilHospitals.map((h) => {
                      const sus = hospSus[h.id] ?? -1;
                      const col = pinColor(sus);
                      const rows = antibiogramData.filter(d => d.hospital_id === h.id);
                      return (
                        <div key={h.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{h.name}</p>
                            <p className="text-xs text-slate-500">{rows.length} {isRTL ? 'سجل' : 'records'}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold" style={{ color: col }}>
                              {sus >= 0 ? `${Math.round(sus)}%` : '—'}
                            </p>
                            <p className="text-xs text-slate-400">{isRTL ? 'حساسية' : 'suscept.'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {chartData.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
              <Globe className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500">{t.regional.noData}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Susceptibility Chart */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                <div className="mb-4 flex items-start justify-between gap-3"><h3 className="text-base font-semibold text-slate-800">
                  {selectedRegion === 'all' 
                    ? t.regional.susceptibilityByRegion 
                    : (isRTL ? 'معدل الحساسية لكل مستشفى (%)' : 'Susceptibility by Hospital (%)')}
                </h3><ChartExportActions targetId="regional-susceptibility-chart" title={selectedRegion === 'all' ? t.regional.susceptibilityByRegion : 'Susceptibility by Hospital'} fileName="regional-susceptibility" compact /></div>
                <div id="regional-susceptibility-chart" className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                        formatter={(value) => [`${value}%`, isRTL ? 'معدل الحساسية' : 'Susceptibility']}
                      />
                      <Bar dataKey="susceptibility" radius={[8, 8, 0, 0]} maxBarSize={40}>
                        {chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Volume Chart */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                <div className="mb-4 flex items-start justify-between gap-3"><h3 className="text-base font-semibold text-slate-800">
                  {selectedRegion === 'all' 
                    ? t.regional.isolatesByRegion 
                    : (isRTL ? 'حجم العزلات لكل مستشفى' : 'Isolate Volume by Hospital')}
                </h3><ChartExportActions targetId="regional-volume-chart" title={selectedRegion === 'all' ? t.regional.isolatesByRegion : 'Isolate Volume by Hospital'} fileName="regional-isolate-volume" compact /></div>
                <div id="regional-volume-chart" className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                        formatter={(value) => [value, isRTL ? 'عدد العزلات' : 'Isolates']}
                      />
                      <Bar dataKey="isolates" radius={[8, 8, 0, 0]} maxBarSize={40} fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Comparison Table */}
              <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800">
                    {selectedRegion === 'all'
                      ? (isRTL ? 'تفاصيل مقارنة المناطق' : 'Regional Comparison Details')
                      : (isRTL ? `تفاصيل المستشفيات: ${arName(selectedRegion)}` : `Hospital Details: ${selectedRegion}`)}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 font-semibold text-center">
                      <tr>
                        <th className="px-6 py-3 text-left">
                          {selectedRegion === 'all' ? (isRTL ? 'المنطقة' : 'Region') : (isRTL ? 'المستشفى' : 'Hospital')}
                        </th>
                        {selectedRegion === 'all' ? (
                          <th className="px-6 py-3 text-center">{t.regional.hospitalsCount}</th>
                        ) : (
                          <th className="px-6 py-3 text-center">{isRTL ? 'المنطقة' : 'Region'}</th>
                        )}
                        <th className="px-6 py-3 text-center">{isRTL ? 'حجم العينات' : 'Isolates Analyzed'}</th>
                        <th className="px-6 py-3 text-center">{isRTL ? 'حساسية المضاد (%)' : 'Susceptibility (%)'}</th>
                        <th className="px-6 py-3 text-center">{isRTL ? 'مقاومة المضاد (%)' : 'Resistance (%)'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {chartData.map((row, index) => {
                        const resistance = Math.round((100 - row.susceptibility) * 10) / 10;
                        return (
                          <tr key={index} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900 text-left">{row.name}</td>
                            {selectedRegion === 'all' ? (
                              <td className="px-6 py-4 text-center">{row.sites}</td>
                            ) : (
                              <td className="px-6 py-4 text-center">
                                {isRTL ? (arName(selectedRegion)) : selectedRegion}
                              </td>
                            )}
                            <td className="px-6 py-4 text-center">{row.isolates.toLocaleString()}</td>
                            <td className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                row.susceptibility >= 80 ? 'bg-emerald-50 text-emerald-700' :
                                row.susceptibility >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                              }`}>
                                {row.susceptibility}%
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                resistance >= 40 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {resistance}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* K-Means Hospital Clustering */}
      {clusters.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Network className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">
                  {isRTL ? 'تجميع المستشفيات (K-Means)' : 'Hospital Clustering (K-Means)'}
                </h3>
                <p className="text-sm text-slate-500">
                  {isRTL ? 'تصنيف المستشفيات حسب تشابه أنماط المقاومة' : 'Hospitals grouped by resistance profile similarity'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setClusterSeed((s) => s + 1);
                const nameMap: Record<string, string> = {};
                hospitals.forEach((h) => { nameMap[h.id] = h.name; });
                const vectors = buildHospitalVectors(antibiogramData, nameMap);
                if (vectors.length >= 2) setClusters(kMeans(vectors, Math.min(3, vectors.length)));
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${clusterSeed > 0 ? 'animate-spin-once' : ''}`} />
              {isRTL ? 'إعادة' : 'Re-run'}
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(() => {
              const COLORS = ['#0d9488', '#7c3aed', '#db2777'];
              const NAMES_EN = ['Group A', 'Group B', 'Group C'];
              const NAMES_AR = ['مجموعة أ', 'مجموعة ب', 'مجموعة ج'];
              const grouped = new Map<number, ClusterResult[]>();
              clusters.forEach((c) => {
                if (!grouped.has(c.clusterId)) grouped.set(c.clusterId, []);
                grouped.get(c.clusterId)!.push(c);
              });
              return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([cid, members]) => {
                const color = COLORS[cid % COLORS.length];
                const name = isRTL ? NAMES_AR[cid % NAMES_AR.length] : NAMES_EN[cid % NAMES_EN.length];
                const avgDist = members.reduce((s, m) => s + m.distanceToCentroid, 0) / members.length;
                return (
                  <div key={cid} className="rounded-2xl border border-slate-100 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: `${color}18`, borderBottom: `2px solid ${color}40` }}>
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-semibold text-slate-800 text-sm">{name}</span>
                      <span className="ms-auto text-xs text-slate-500">{members.length} {isRTL ? 'مستشفيات' : 'hospitals'}</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {members.sort((a, b) => a.distanceToCentroid - b.distanceToCentroid).map((m) => (
                        <div key={m.hospitalId} className="px-4 py-2.5 flex items-center justify-between">
                          <span className="text-sm text-slate-700 truncate">{m.hospitalName}</span>
                          <span className="text-xs text-slate-400 shrink-0 ms-2">{m.distanceToCentroid.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2 bg-slate-50 text-xs text-slate-400">
                      ø {isRTL ? 'البُعد' : 'dist'}: {avgDist.toFixed(1)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
