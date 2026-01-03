import { useState, useMemo, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Footer from '../components/Footer';
import { RED_LIGHT_CAMERAS, RedLightCamera } from '../lib/red-light-cameras';
import type { SpeedCamera, UserLocation } from '../components/CameraMap';
import {
  ViolationBlock,
  ViolationsData,
  parseViolationsData,
  VIOLATION_CATEGORIES,
  ViolationCategoryKey,
  aggregateBlockStats,
  getBlocksNearLocation
} from '../lib/violations';
import {
  CrimeBlock,
  CrimesData,
  parseCrimesData,
  CRIME_CATEGORIES,
  CrimeCategoryKey,
  aggregateCrimeStats,
  getCrimeScoreColor,
  CrashBlock,
  CrashesData,
  parseCrashesData,
  aggregateCrashStats,
  getCrashScoreColor,
  ServiceRequestBlock,
  ServiceRequestsData,
  parseServiceRequestsData,
  SERVICE_REQUEST_CATEGORIES,
  ServiceRequestCategoryKey,
  aggregateServiceRequestStats,
  getBlocksNearLocation as getBlocksNear,
  // New data types
  PermitBlock,
  PermitsData,
  parsePermitsData,
  PERMIT_CATEGORIES,
  PermitCategoryKey,
  aggregatePermitStats,
  LicenseBlock,
  LicensesData,
  parseLicensesData,
  LICENSE_CATEGORIES,
  LicenseCategoryKey,
  aggregateLicenseStats,
  PotholeBlock,
  PotholesData,
  parsePotholesData,
  aggregatePotholeStats,
} from '../lib/neighborhood-data';

const CameraMap = dynamic(() => import('../components/CameraMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '600px',
      backgroundColor: '#f3f4f6',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <p style={{ color: '#6b7280' }}>Loading map...</p>
    </div>
  )
});

type CameraFilter = 'all' | 'speed' | 'redlight';
type StatusFilter = 'all' | 'active' | 'upcoming';
type DataLayer = 'cameras' | 'violations' | 'crimes' | 'crashes' | '311' | 'permits' | 'licenses' | 'potholes';

// Speed camera data from Chicago Data Portal
const SPEED_CAMERAS: SpeedCamera[] = [
  { id: "195", locationId: "CHI015", address: "3450 W 71st St", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-09-06", latitude: 41.7644, longitude: -87.7097 },
  { id: "232", locationId: "CHI039", address: "6247 W Fullerton Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2013-12-21", latitude: 41.9236, longitude: -87.7825 },
  { id: "233", locationId: "CHI040", address: "6250 W Fullerton Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-12-21", latitude: 41.9238, longitude: -87.7826 },
  { id: "227", locationId: "CHI041", address: "5509 W Fullerton Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2013-12-12", latitude: 41.9239, longitude: -87.7639 },
  { id: "226", locationId: "CHI042", address: "5446 W Fullerton Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-12-12", latitude: 41.9241, longitude: -87.763 },
  { id: "243", locationId: "CHI044", address: "4843 W Fullerton Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-13", latitude: 41.9241, longitude: -87.748 },
  { id: "242", locationId: "CHI048", address: "3843 W 111th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-13", latitude: 41.6912, longitude: -87.7172 },
  { id: "213", locationId: "CHI051", address: "6523 N Western Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2013-11-10", latitude: 42.0003, longitude: -87.6898 },
  { id: "239", locationId: "CHI055", address: "4433 N Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-04", latitude: 41.9623, longitude: -87.6886 },
  { id: "228", locationId: "CHI064", address: "7739 S Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2013-12-18", latitude: 41.7526, longitude: -87.6828 },
  { id: "229", locationId: "CHI065", address: "7738 S Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2013-12-18", latitude: 41.75269, longitude: -87.6831 },
  { id: "231", locationId: "CHI067", address: "2550 W 79th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-12-18", latitude: 41.7502, longitude: -87.6874 },
  { id: "217", locationId: "CHI068", address: "5529 S Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2013-11-23", latitude: 41.79249, longitude: -87.6839 },
  { id: "303", locationId: "CHI071", address: "7833 S Pulaski Rd", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-02-14", latitude: 41.7504, longitude: -87.7218 },
  { id: "304", locationId: "CHI072", address: "7826 S Pulaski Rd", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-02-14", latitude: 41.7505, longitude: -87.7221 },
  { id: "263", locationId: "CHI074", address: "3832 W 79th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-02-10", latitude: 41.74969, longitude: -87.7196 },
  { id: "246", locationId: "CHI077", address: "115 N Ogden Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2014-01-25", latitude: 41.8832, longitude: -87.6641 },
  { id: "214", locationId: "CHI078", address: "2721 W Montrose Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2013-11-15", latitude: 41.9611, longitude: -87.697 },
  { id: "215", locationId: "CHI079", address: "2705 W Irving Park Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2013-11-15", latitude: 41.9539, longitude: -87.6962 },
  { id: "216", locationId: "CHI080", address: "2712 W Irving Park Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-11-15", latitude: 41.9541, longitude: -87.6966 },
  { id: "218", locationId: "CHI069", address: "5520 S Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2013-11-23", latitude: 41.7928, longitude: -87.6842 },
  { id: "306", locationId: "CHI134", address: "2115 S Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-04-25", latitude: 41.8534, longitude: -87.6855 },
  { id: "307", locationId: "CHI135", address: "2108 S Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-04-25", latitude: 41.8536, longitude: -87.6858 },
  { id: "310", locationId: "CHI136", address: "346 W 76th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-04-30", latitude: 41.7564, longitude: -87.6338 },
  { id: "317", locationId: "CHI141", address: "3542 E 95th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-06-30", latitude: 41.723, longitude: -87.537 },
  { id: "321", locationId: "CHI163", address: "1110 S Pulaski Rd", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-09-05", latitude: 41.8676, longitude: -87.7254 },
  { id: "336", locationId: "CHI167", address: "3212 W 55th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2015-01-07", latitude: 41.7936, longitude: -87.7042 },
  { id: "329", locationId: "CHI168", address: "8345 S Ashland Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-10-11", latitude: 41.7417, longitude: -87.6631 },
  { id: "331", locationId: "CHI171", address: "3111 N Ashland Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-09-26", latitude: 41.9383, longitude: -87.6685 },
  { id: "343", locationId: "CHI173", address: "5006 S Western Blvd", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2018-01-08", latitude: 41.8028, longitude: -87.6837 },
  { id: "7", locationId: "CHI180", address: "7157 S South Chicago Ave", firstApproach: "NWB", secondApproach: null, goLiveDate: "2018-08-20", latitude: 41.7647, longitude: -87.6037 },
  { id: "4", locationId: "CHI175", address: "8043 W Addison St", firstApproach: "EB", secondApproach: null, goLiveDate: "2018-07-16", latitude: 41.945, longitude: -87.8282 },
  { id: "46", locationId: "CHI093", address: "5885 N Ridge Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-03-18", latitude: 41.98891, longitude: -87.66856 },
  { id: "45", locationId: "CHI091", address: "2443 N Ashland", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-25", latitude: 41.92642, longitude: -87.66806 },
  { id: "47", locationId: "CHI206", address: "1732 W 99th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2024-07-15", latitude: 41.71398, longitude: -87.66672 },
  { id: "48", locationId: "CHI207", address: "2700 W 103rd St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2024-05-20", latitude: 41.7065, longitude: -87.6892 },
  { id: "49", locationId: "CHI205", address: "10540 S Western Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2024-05-28", latitude: 41.70148, longitude: -87.68162 },
  { id: "300", locationId: "CHI057", address: "515 S Central Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-04-14", latitude: 41.8733, longitude: -87.7645 },
  { id: "289", locationId: "CHI107", address: "4041 W Chicago Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-03-24", latitude: 41.8952, longitude: -87.7277 },
  { id: "312", locationId: "CHI138", address: "1901 E 75th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-04-30", latitude: 41.75869, longitude: -87.5785 },
  { id: "320", locationId: "CHI162", address: "1117 S Pulaski Rd", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-09-05", latitude: 41.8674, longitude: -87.7251 },
  { id: "328", locationId: "CHI169", address: "8318 S Ashland Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-10-11", latitude: 41.7425, longitude: -87.6634 },
  { id: "22", locationId: "CHI192", address: "6020 W Foster Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2023-03-10", latitude: 41.9758, longitude: -87.7786 },
  { id: "5", locationId: "CHI176", address: "8006 W Addison St", firstApproach: "WB", secondApproach: null, goLiveDate: "2018-07-16", latitude: 41.945, longitude: -87.8271 },
  { id: "206", locationId: "CHI021", address: "2900 W Ogden Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-10-17", latitude: 41.8604, longitude: -87.6987 },
  { id: "251", locationId: "CHI027", address: "3534 N Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-01-31", latitude: 41.946, longitude: -87.6884 },
  { id: "219", locationId: "CHI096", address: "4429 N Broadway Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2013-11-23", latitude: 41.9626, longitude: -87.6555 },
  { id: "236", locationId: "CHI024", address: "3137 W Peterson Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-03", latitude: 41.9903, longitude: -87.7095 },
  { id: "278", locationId: "CHI104", address: "3115 N Narragansett Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-03-10", latitude: 41.93699, longitude: -87.7857 },
  { id: "6", locationId: "CHI177", address: "3911 W Diversey Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2018-07-16", latitude: 41.9318, longitude: -87.7254 },
  { id: "305", locationId: "CHI083", address: "6226 W Irving Park Rd", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2014-04-26", latitude: 41.9531, longitude: -87.7828 },
  { id: "15", locationId: "CHI185", address: "1306 W 76th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2021-07-09", latitude: 41.756, longitude: -87.657 },
  { id: "314", locationId: "CHI125", address: "450 N Columbus Dr", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-01-07", latitude: 41.89009, longitude: -87.6204 },
  { id: "203", locationId: "CHI019", address: "2917 W Roosevelt Rd", firstApproach: "EB", secondApproach: null, goLiveDate: "2013-10-05", latitude: 41.8664, longitude: -87.6991 },
  { id: "26", locationId: "CHI189", address: "901 N Clark St", firstApproach: "SB", secondApproach: null, goLiveDate: "2023-03-21", latitude: 41.8988, longitude: -87.6313 },
  { id: "241", locationId: "CHI056", address: "4432 N Lincoln Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-01-04", latitude: 41.9623, longitude: -87.6846 },
  { id: "13", locationId: "CHI183", address: "1444 W Division St", firstApproach: "WB", secondApproach: null, goLiveDate: "2018-09-05", latitude: 41.9035, longitude: -87.6644 },
  { id: "40", locationId: "CHI195", address: "3314 W 16th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-05-08", latitude: 41.8591, longitude: -87.7083 },
  { id: "297", locationId: "CHI087", address: "3230 N Milwaukee Ave", firstApproach: "SB", secondApproach: "WB", goLiveDate: "2014-04-08", latitude: 41.9397, longitude: -87.7251 },
  { id: "308", locationId: "CHI133", address: "19 E Chicago Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-04-29", latitude: 41.8966, longitude: -87.629 },
  { id: "207", locationId: "CHI011", address: "3100 W Augusta Blvd", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-10-17", latitude: 41.89929, longitude: -87.7045 },
  { id: "3", locationId: "CHI174", address: "8020 W Forest Preserve Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2018-07-16", latitude: 41.9442, longitude: -87.8275 },
  { id: "291", locationId: "CHI109", address: "732 N Pulaski Rd", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-03-24", latitude: 41.8945, longitude: -87.7262 },
  { id: "9", locationId: "CHI184", address: "7122 S South Chicago Ave", firstApproach: "SEB", secondApproach: null, goLiveDate: "2018-08-20", latitude: 41.7652, longitude: -87.6048 },
  { id: "332", locationId: "CHI172", address: "3130 N Ashland Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-09-26", latitude: 41.9388, longitude: -87.6688 },
  { id: "270", locationId: "CHI128", address: "1226 S Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-02-24", latitude: 41.90379, longitude: -87.6872 },
  { id: "24", locationId: "CHI188", address: "6935 W Addison St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-03-15", latitude: 41.94543, longitude: -87.80021 },
  { id: "194", locationId: "CHI003", address: "4124 W Foster Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-08-23", latitude: 41.9755, longitude: -87.7317 },
  { id: "284", locationId: "CHI114", address: "6125 N Cicero Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2014-03-17", latitude: 41.9921, longitude: -87.7485 },
  { id: "255", locationId: "CHI032", address: "4925 S Archer Ave", firstApproach: "NEB", secondApproach: "SWB", goLiveDate: "2014-01-31", latitude: 41.8036, longitude: -87.721 },
  { id: "43", locationId: "CHI199", address: "4350 W 79th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2023-05-19", latitude: 41.74949, longitude: -87.7289 },
  { id: "235", locationId: "CHI120", address: "10318 S Indianapolis Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2013-12-24", latitude: 41.7076, longitude: -87.5298 },
  { id: "208", locationId: "CHI045", address: "445 W 127th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2013-10-17", latitude: 41.6632, longitude: -87.6337 },
  { id: "39", locationId: "CHI117", address: "2928 S Halsted St", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-01-18", latitude: 41.8408, longitude: -87.6463 },
  { id: "31", locationId: "CHI202", address: "5433 S Pulaski Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2023-04-18", latitude: 41.79399, longitude: -87.723 },
  { id: "11", locationId: "CHI179", address: "4246 W 47th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2018-08-27", latitude: 41.8078, longitude: -87.7301 },
  { id: "28", locationId: "CHI194", address: "4516 W Marquette Rd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-03-30", latitude: 41.77129, longitude: -87.7358 },
  { id: "309", locationId: "CHI139", address: "14 W Chicago Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-04-29", latitude: 41.8968, longitude: -87.6288 },
  { id: "23", locationId: "CHI186", address: "2638 W Fullerton Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-03-10", latitude: 41.9249, longitude: -87.6941 },
  { id: "275", locationId: "CHI112", address: "1635 N Ashland Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-03-03", latitude: 41.9117, longitude: -87.6676 },
  { id: "271", locationId: "CHI127", address: "1229 N Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-02-24", latitude: 41.9039, longitude: -87.6869 },
  { id: "272", locationId: "CHI129", address: "2329 W Division St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-02-24", latitude: 41.9029, longitude: -87.6858 },
  { id: "324", locationId: "CHI145", address: "2109 E 87th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-09-18", latitude: 41.737, longitude: -87.5729 },
  { id: "319", locationId: "CHI158", address: "6510 W Bryn Mawr Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-09-05", latitude: 41.983, longitude: -87.7908 },
  { id: "335", locationId: "CHI166", address: "3217 W 55th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2015-01-07", latitude: 41.7934, longitude: -87.7043 },
  { id: "327", locationId: "CHI170", address: "1507 W 83rd St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-10-11", latitude: 41.743, longitude: -87.6611 },
  { id: "199", locationId: "CHI008", address: "3655 W Jackson Blvd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2013-09-10", latitude: 41.8771, longitude: -87.7182 },
  { id: "222", locationId: "CHI034", address: "630 S State St", firstApproach: "SB", secondApproach: null, goLiveDate: "2013-11-25", latitude: 41.8738, longitude: -87.6277 },
  { id: "240", locationId: "CHI094", address: "4436 N Western Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-01-04", latitude: 41.9624, longitude: -87.6889 },
  { id: "220", locationId: "CHI097", address: "4446 N Broadway Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2013-11-23", latitude: 41.9629, longitude: -87.656 },
  { id: "21", locationId: "CHI193", address: "7508 W Touhy Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-03-02", latitude: 42.0116, longitude: -87.8142 },
  { id: "36", locationId: "CHI063", address: "7518 S Vincennes Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-02-17", latitude: 41.7571, longitude: -87.6318 },
  { id: "285", locationId: "CHI115", address: "4707 W Peterson Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-03-17", latitude: 41.9898, longitude: -87.7462 },
  { id: "286", locationId: "CHI116", address: "4674 W Peterson Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-03-17", latitude: 41.99, longitude: -87.7453 },
  { id: "33", locationId: "CHI201", address: "2501 W Irving Park Rd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-05-02", latitude: 41.9539, longitude: -87.6913 },
  { id: "44", locationId: "CHI204", address: "655 W. Root St.", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-07-28", latitude: 41.8189, longitude: -87.6425 },
  { id: "338", locationId: "CHI148", address: "6330 S Dr Martin Luther King Jr Dr", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2023-07-11", latitude: 41.7793, longitude: -87.6161 },
  { id: "27", locationId: "CHI190", address: "3601 N Milwaukee Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2023-03-30", latitude: 41.9466, longitude: -87.736 },
  { id: "264", locationId: "CHI103", address: "5432 W Lawrence Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2014-02-14", latitude: 41.9678, longitude: -87.7639 },
  { id: "325", locationId: "CHI149", address: "4909 N Cicero Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2014-09-18", latitude: 41.9701, longitude: -87.7477 },
  { id: "296", locationId: "CHI049", address: "4123 N Central Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2014-03-31", latitude: 41.9557, longitude: -87.7669 },
  { id: "30", locationId: "CHI203", address: "5428 S Pulaski S Rd", firstApproach: "SB", secondApproach: null, goLiveDate: "2023-03-20", latitude: 41.79419, longitude: -87.7233 },
  { id: "262", locationId: "CHI073", address: "3851 W 79th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-02-10", latitude: 41.7494, longitude: -87.7191 },
  { id: "212", locationId: "CHI050", address: "5454 W Irving Park", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-11-10", latitude: 41.9533, longitude: -87.7643 },
  { id: "38", locationId: "CHI095", address: "1142 W Irving Park Rd", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-12-06", latitude: 41.9545, longitude: -87.6589 },
  { id: "237", locationId: "CHI022", address: "11153 S Vincennes Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-08", latitude: 41.6907, longitude: -87.6641 },
  { id: "223", locationId: "CHI029", address: "536 E Morgan Dr", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-19", latitude: 41.7935, longitude: -87.6119 },
  { id: "281", locationId: "CHI106", address: "6514 W Belmont Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-03-10", latitude: 41.9384, longitude: -87.7891 },
  { id: "290", locationId: "CHI108", address: "4040 W Chicago Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-03-24", latitude: 41.8954, longitude: -87.7277 },
  { id: "276", locationId: "CHI113", address: "1638 N Ashland Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-03-03", latitude: 41.9118, longitude: -87.6679 },
  { id: "301", locationId: "CHI130", address: "506 S Central Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-04-14", latitude: 41.8736, longitude: -87.7648 },
  { id: "311", locationId: "CHI137", address: "341 W 76th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-04-30", latitude: 41.7561, longitude: -87.6336 },
  { id: "316", locationId: "CHI140", address: "3535 E 95th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-06-30", latitude: 41.7228, longitude: -87.5376 },
  { id: "342", locationId: "CHI161", address: "4042 W North Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2015-11-09", latitude: 41.90999, longitude: -87.7281 },
  { id: "234", locationId: "CHI010", address: "1111 N Humboldt Blvd", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2013-11-19", latitude: 41.9014, longitude: -87.7021 },
  { id: "250", locationId: "CHI026", address: "3521 N Western Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-31", latitude: 41.9456, longitude: -87.6881 },
  { id: "253", locationId: "CHI030", address: "4929 S Pulaski Rd", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-31", latitude: 41.8033, longitude: -87.7233 },
  { id: "254", locationId: "CHI031", address: "5030 S Pulaski Rd", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-01-31", latitude: 41.8014, longitude: -87.7235 },
  { id: "221", locationId: "CHI033", address: "629 S State St", firstApproach: "NB", secondApproach: null, goLiveDate: "2013-11-25", latitude: 41.8738, longitude: -87.6274 },
  { id: "268", locationId: "CHI098", address: "2445 W 51st St", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-02-24", latitude: 41.801, longitude: -87.6861 },
  { id: "12", locationId: "CHI182", address: "1455 W Division St", firstApproach: "EB", secondApproach: null, goLiveDate: "2018-09-05", latitude: 41.9033, longitude: -87.6649 },
  { id: "204", locationId: "CHI025", address: "3034 W Foster Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-10-05", latitude: 41.9759, longitude: -87.7048 },
  { id: "205", locationId: "CHI013", address: "5330 S Cottage Grove Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2013-10-05", latitude: 41.7977, longitude: -87.6064 },
  { id: "41", locationId: "CHI197", address: "1215 E 83RD ST", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-05-05", latitude: 41.7442, longitude: -87.5933 },
  { id: "211", locationId: "CHI058", address: "5816 W Jackson Blvd", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-11-06", latitude: 41.8772, longitude: -87.7704 },
  { id: "298", locationId: "CHI088", address: "3809 W Belmont Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2023-07-20", latitude: 41.939, longitude: -87.7226 },
  { id: "10", locationId: "CHI178", address: "4319 W 47th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2018-08-27", latitude: 41.8076, longitude: -87.7318 },
  { id: "313", locationId: "CHI124", address: "449 N Columbus Dr", firstApproach: "NB", secondApproach: null, goLiveDate: "2014-01-07", latitude: 41.89, longitude: -87.6202 },
  { id: "248", locationId: "CHI092", address: "2432 N Ashland Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-01-25", latitude: 41.9262, longitude: -87.6683 },
  { id: "201", locationId: "CHI005", address: "2080 W Pershing Rd", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-09-07", latitude: 41.8232, longitude: -87.678 },
  { id: "25", locationId: "CHI191", address: "4949 W Lawrence Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2023-03-22", latitude: 41.9679, longitude: -87.7523 },
  { id: "340", locationId: "CHI157", address: "1754 N Pulaski Rd", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2015-11-09", latitude: 41.9134, longitude: -87.7266 },
  { id: "193", locationId: "CHI004", address: "5120 N Pulaski Rd", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2013-08-26", latitude: 41.9743, longitude: -87.7282 },
  { id: "29", locationId: "CHI196", address: "3536 S Wallace St", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2023-05-08", latitude: 41.8297, longitude: -87.6413 },
  { id: "265", locationId: "CHI102", address: "5471 W Higgins Rd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-02-14", latitude: 41.9692, longitude: -87.764 },
  { id: "280", locationId: "CHI105", address: "6443 W Belmont Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-03-10", latitude: 41.9382, longitude: -87.7877 },
  { id: "292", locationId: "CHI119", address: "1334 W Garfield Blvd", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-03-24", latitude: 41.79419, longitude: -87.6587 },
  { id: "293", locationId: "CHI121", address: "1315 W Garfield Blvd", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-03-24", latitude: 41.7936, longitude: -87.6579 },
  { id: "288", locationId: "CHI123", address: "324 S Kedzie Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2014-03-17", latitude: 41.8766, longitude: -87.7061 },
  { id: "302", locationId: "CHI126", address: "324 E Illinois St", firstApproach: "EB", secondApproach: null, goLiveDate: "2014-04-14", latitude: 41.8909, longitude: -87.6193 },
  { id: "197", locationId: "CHI014", address: "6909 S Kedzie Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2013-09-06", latitude: 41.7677, longitude: -87.7027 },
  { id: "196", locationId: "CHI018", address: "6818 S Kedzie Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2013-09-06", latitude: 41.7691, longitude: -87.703 },
  { id: "202", locationId: "CHI020", address: "2912 W Roosevelt Rd", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-10-05", latitude: 41.8666, longitude: -87.699 },
  { id: "252", locationId: "CHI028", address: "2549 W Addison St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-31", latitude: 41.9466, longitude: -87.6905 },
  { id: "210", locationId: "CHI035", address: "57 E 95th St", firstApproach: "WB", secondApproach: null, goLiveDate: "2013-10-12", latitude: 41.7216, longitude: -87.6215 },
  { id: "209", locationId: "CHI036", address: "62 E 95th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2013-10-12", latitude: 41.7219, longitude: -87.6214 },
  { id: "267", locationId: "CHI099", address: "2440 W 51st St", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-02-24", latitude: 41.8012, longitude: -87.6859 },
  { id: "198", locationId: "CHI009", address: "3646 W Madison St", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-09-10", latitude: 41.88089, longitude: -87.7179 },
  { id: "34", locationId: "CHI198", address: "2223 N Kedzie Blvd", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2023-05-02", latitude: 41.92199, longitude: -87.707 },
  { id: "277", locationId: "CHI086", address: "4620 W Belmont Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2014-03-10", latitude: 41.939, longitude: -87.7431 },
  { id: "225", locationId: "CHI043", address: "5440 W Grand Ave", firstApproach: "WB", secondApproach: "EB", goLiveDate: "2013-12-12", latitude: 41.9182, longitude: -87.7623 },
  { id: "244", locationId: "CHI070", address: "2513 W 55th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-01-18", latitude: 41.7937, longitude: -87.6872 },
  { id: "299", locationId: "CHI089", address: "3810 W Belmont Ave", firstApproach: "WB", secondApproach: null, goLiveDate: "2014-04-08", latitude: 41.9393, longitude: -87.7228 },
  { id: "287", locationId: "CHI122", address: "3047 W Jackson Blvd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-03-17", latitude: 41.8772, longitude: -87.7029 },
  { id: "279", locationId: "CHI132", address: "3116 N Narragansett Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2014-03-10", latitude: 41.93699, longitude: -87.786 },
  { id: "330", locationId: "CHI146", address: "215 E 63rd St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2014-09-24", latitude: 41.78, longitude: -87.6198 },
  { id: "341", locationId: "CHI159", address: "4053 W North Ave", firstApproach: "EB", secondApproach: null, goLiveDate: "2015-11-09", latitude: 41.9097, longitude: -87.7286 },
  { id: "337", locationId: "CHI164", address: "5532 S Kedzie Ave", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2015-01-07", latitude: 41.79249, longitude: -87.7037 },
  { id: "8", locationId: "CHI181", address: "819 E 71st St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2018-08-20", latitude: 41.7658, longitude: -87.6036 },
  { id: "32", locationId: "CHI187", address: "1817 N Clark St", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2023-04-28", latitude: 41.9159, longitude: -87.6344 },
  { id: "55", locationId: "CHI212", address: "8740 S Vincennes St", firstApproach: "SWB", secondApproach: "NEB", goLiveDate: "2025-06-01", latitude: 41.73469, longitude: -87.6459 },
  { id: "50", locationId: "CHI208", address: "1455 W Grand Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.891, longitude: -87.6646 },
  { id: "52", locationId: "CHI210", address: "2310 E 103rd St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.7081, longitude: -87.5676 },
  { id: "62", locationId: "CHI213", address: "4118 N Ashland Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.9568, longitude: -87.669 },
  { id: "54", locationId: "CHI214", address: "3510 W 55th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.7935, longitude: -87.7121 },
  { id: "65", locationId: "CHI215", address: "7115 N Sheridan Rd", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 42.0122, longitude: -87.663 },
  { id: "51", locationId: "CHI216", address: "2716 W Logan Blvd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.9286, longitude: -87.6958 },
  { id: "56", locationId: "CHI218", address: "1341 W Jackson Blvd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.8778, longitude: -87.6611 },
  { id: "63", locationId: "CHI209", address: "4716 N Ashland", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.9676, longitude: -87.6695 },
  { id: "57", locationId: "CHI219", address: "3665 N Austin Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.9473, longitude: -87.7765 },
  { id: "58", locationId: "CHI220", address: "5059 N Damen Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.974, longitude: -87.6793 },
  { id: "59", locationId: "CHI221", address: "6824 W Foster Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.9756, longitude: -87.7986 },
  { id: "60", locationId: "CHI222", address: "220 W Fullerton Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-01", latitude: 41.9258, longitude: -87.6349 },
  { id: "61", locationId: "CHI223", address: "5432 N Central Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.98, longitude: -87.7683 },
  { id: "64", locationId: "CHI224", address: "5857 N Broadway", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-01", latitude: 41.9887, longitude: -87.6601 },
  { id: "66", locationId: "CHI217", address: "6151 N Sheridan Rd", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-15", latitude: 41.9938, longitude: -87.6554 },
  { id: "72", locationId: "CHI229", address: "7732 S Cottage Grove Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-15", latitude: 41.75372, longitude: -87.60533 },
  { id: "67", locationId: "CHI225", address: "2650 W Peterson Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-15", latitude: 41.9906, longitude: -87.6962 },
  { id: "71", locationId: "CHI230", address: "3358 S Ashland Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-15", latitude: 41.83244, longitude: -87.66575 },
  { id: "68", locationId: "CHI226", address: "6616 N Central Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-15", latitude: 42.0014, longitude: -87.7625 },
  { id: "70", locationId: "CHI227", address: "441 E 71st St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-06-15", latitude: 41.76569, longitude: -87.61362 },
  { id: "69", locationId: "CHI228", address: "8590 S Martin Luther King Dr", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-06-15", latitude: 41.7386, longitude: -87.6147 },
  { id: "75", locationId: "CHI233", address: "1635 N LaSalle", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-07-01", latitude: 41.9122, longitude: -87.633 },
  { id: "74", locationId: "CHI232", address: "49 W 85th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-07-01", latitude: 41.73991, longitude: -87.62662 },
  { id: "76", locationId: "CHI234", address: "5941 N Nagle", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-07-01", latitude: 41.99002, longitude: -87.78753 },
  { id: "73", locationId: "CHI231", address: "614 W 47th Street", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-07-01", latitude: 41.80901, longitude: -87.6416 },
  { id: "77", locationId: "CHI236", address: "1477 W. Cermak Rd", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-07-15", latitude: 41.8523, longitude: -87.6631 },
  { id: "78", locationId: "CHI238", address: "147 S Desplaines St", firstApproach: "SB", secondApproach: null, goLiveDate: "2025-07-15", latitude: 41.8799, longitude: -87.644 },
  { id: "85", locationId: "CHI242", address: "6201 S Pulaski Rd", firstApproach: "NB", secondApproach: null, goLiveDate: "2025-08-15", latitude: 41.78033, longitude: -87.72263 },
  { id: "80", locationId: "CHI235", address: "4021 W Belmont Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-08-01", latitude: 41.939, longitude: -87.72888 },
  { id: "84", locationId: "CHI244", address: "6198 S Pulaski Rd", firstApproach: "SB", secondApproach: null, goLiveDate: "2025-08-15", latitude: 41.78037, longitude: -87.72297 },
  { id: "81", locationId: "CHI237", address: "812 S Racine Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-08-01", latitude: 41.87141, longitude: -87.6569 },
  { id: "79", locationId: "CHI239", address: "216 S Jefferson St", firstApproach: "NB", secondApproach: null, goLiveDate: "2025-08-01", latitude: 41.87876, longitude: -87.64267 },
  { id: "83", locationId: "CHI241", address: "2948 W 47th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-08-01", latitude: 41.80827, longitude: -87.69862 },
  { id: "86", locationId: "CHI247", address: "4298 w 59th St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-09-01", latitude: 41.78593, longitude: -87.7301 },
  { id: "88", locationId: "CHI246", address: "2718 S Kedzie Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-09-01", latitude: 41.84211, longitude: -87.7051 },
  { id: "89", locationId: "CHI249", address: "851 W 103rd St", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-09-01", latitude: 41.70684, longitude: -87.6448 },
  { id: "87", locationId: "CHI245", address: "3624 S Western Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-09-01", latitude: 41.8278, longitude: -87.6851 },
  { id: "90", locationId: "CHI250", address: "200 S Michigan Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2025-09-15", latitude: 41.87944, longitude: -87.62452 },
  { id: "93", locationId: "CHI252", address: "2711 N Pulaski", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-10-15", latitude: 41.9307, longitude: -87.7269 },
  { id: "92", locationId: "CHI251", address: "451 E Grand Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-10-01", latitude: 41.89179, longitude: -87.61597 },
  { id: "95", locationId: "CHI254", address: "5050 W Fullerton Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-11-01", latitude: 41.9242, longitude: -87.7534 },
  { id: "96", locationId: "CHI255", address: "2622 N. Laramie Ave", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-11-01", latitude: 41.92859, longitude: -87.75641 },
  { id: "97", locationId: "CHI256", address: "4424 W Diversey Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-11-01", latitude: 41.93172, longitude: -87.73789 },
  { id: "98", locationId: "CHI257", address: "8134 S Yates Blvd", firstApproach: "NB", secondApproach: "SB", goLiveDate: "2025-11-01", latitude: 41.74709, longitude: -87.56623 },
  { id: "53", locationId: "CHI211", address: "2740 S Archer Ave", firstApproach: "SEB", secondApproach: "NWB", goLiveDate: "2025-06-01", latitude: 41.8442, longitude: -87.653 },
  { id: "101", locationId: "CHI258", address: "504 W 69th Ave", firstApproach: "EB", secondApproach: "WB", goLiveDate: "2025-12-01", latitude: 41.76901, longitude: -87.63818 },
  { id: "82", locationId: "CHI243", address: "8550 S Lafayette Ave", firstApproach: "SB", secondApproach: null, goLiveDate: "2025-08-01", latitude: 41.7388, longitude: -87.6256 },
  { id: "102", locationId: "CHI259", address: "4451 W 79th St", firstApproach: "EB", secondApproach: null, goLiveDate: "2026-02-15", latitude: 41.74931, longitude: -87.73281 },
  { id: "294", locationId: "CHI090", address: "2448 Clybourn", firstApproach: "SEB", secondApproach: "NWB", goLiveDate: "2014-03-28", latitude: 41.9262, longitude: -87.6709 },
  { id: "315", locationId: "CHI142", address: "9618 S. Ewing", firstApproach: "SB", secondApproach: "NB", goLiveDate: "2014-05-31", latitude: 41.7207, longitude: -87.5354 },
  { id: "100", locationId: "CHI248", address: "385 Michigan Ave", firstApproach: "NB", secondApproach: null, goLiveDate: "2025-12-01", latitude: 41.87744, longitude: -87.62408 },
];

export default function Neighborhoods() {
  const router = useRouter();
  const [selectedSpeedCamera, setSelectedSpeedCamera] = useState<SpeedCamera | null>(null);
  const [selectedRedLightCamera, setSelectedRedLightCamera] = useState<RedLightCamera | null>(null);
  const [cameraSearchQuery, setCameraSearchQuery] = useState('');
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Data layer state
  const [activeLayer, setActiveLayer] = useState<DataLayer>('cameras');

  // Violations
  const [violationBlocks, setViolationBlocks] = useState<ViolationBlock[]>([]);
  const [violationCategory, setViolationCategory] = useState<ViolationCategoryKey | 'all'>('all');
  const [violationsLoaded, setViolationsLoaded] = useState(false);

  // Crimes
  const [crimeBlocks, setCrimeBlocks] = useState<CrimeBlock[]>([]);
  const [crimeCategory, setCrimeCategory] = useState<CrimeCategoryKey | 'all'>('all');
  const [crimesLoaded, setCrimesLoaded] = useState(false);

  // Crashes
  const [crashBlocks, setCrashBlocks] = useState<CrashBlock[]>([]);
  const [crashesLoaded, setCrashesLoaded] = useState(false);

  // 311 Service Requests
  const [serviceBlocks, setServiceBlocks] = useState<ServiceRequestBlock[]>([]);
  const [serviceCategory, setServiceCategory] = useState<ServiceRequestCategoryKey | 'all'>('all');
  const [servicesLoaded, setServicesLoaded] = useState(false);

  // Building Permits
  const [permitBlocks, setPermitBlocks] = useState<PermitBlock[]>([]);
  const [permitCategory, setPermitCategory] = useState<PermitCategoryKey | 'all'>('all');
  const [permitsLoaded, setPermitsLoaded] = useState(false);

  // Business Licenses
  const [licenseBlocks, setLicenseBlocks] = useState<LicenseBlock[]>([]);
  const [licenseCategory, setLicenseCategory] = useState<LicenseCategoryKey | 'all'>('all');
  const [licensesLoaded, setLicensesLoaded] = useState(false);

  // Potholes Patched
  const [potholeBlocks, setPotholeBlocks] = useState<PotholeBlock[]>([]);
  const [potholesLoaded, setPotholesLoaded] = useState(false);

  // Load data based on active layer
  useEffect(() => {
    if (activeLayer === 'violations' && !violationsLoaded) {
      fetch('/violations-data.json')
        .then(res => res.json())
        .then((data: ViolationsData) => {
          setViolationBlocks(parseViolationsData(data));
          setViolationsLoaded(true);
        })
        .catch(err => console.error('Failed to load violations data:', err));
    }
    if (activeLayer === 'crimes' && !crimesLoaded) {
      fetch('/crimes-data.json')
        .then(res => res.json())
        .then((data: CrimesData) => {
          setCrimeBlocks(parseCrimesData(data));
          setCrimesLoaded(true);
        })
        .catch(err => console.error('Failed to load crimes data:', err));
    }
    if (activeLayer === 'crashes' && !crashesLoaded) {
      fetch('/crashes-data.json')
        .then(res => res.json())
        .then((data: CrashesData) => {
          setCrashBlocks(parseCrashesData(data));
          setCrashesLoaded(true);
        })
        .catch(err => console.error('Failed to load crashes data:', err));
    }
    if (activeLayer === '311' && !servicesLoaded) {
      fetch('/311-data.json')
        .then(res => res.json())
        .then((data: ServiceRequestsData) => {
          setServiceBlocks(parseServiceRequestsData(data));
          setServicesLoaded(true);
        })
        .catch(err => console.error('Failed to load 311 data:', err));
    }
    if (activeLayer === 'permits' && !permitsLoaded) {
      fetch('/permits-data.json')
        .then(res => res.json())
        .then((data: PermitsData) => {
          setPermitBlocks(parsePermitsData(data));
          setPermitsLoaded(true);
        })
        .catch(err => console.error('Failed to load permits data:', err));
    }
    if (activeLayer === 'licenses' && !licensesLoaded) {
      fetch('/licenses-data.json')
        .then(res => res.json())
        .then((data: LicensesData) => {
          setLicenseBlocks(parseLicensesData(data));
          setLicensesLoaded(true);
        })
        .catch(err => console.error('Failed to load licenses data:', err));
    }
    if (activeLayer === 'potholes' && !potholesLoaded) {
      fetch('/potholes-data.json')
        .then(res => res.json())
        .then((data: PotholesData) => {
          setPotholeBlocks(parsePotholesData(data));
          setPotholesLoaded(true);
        })
        .catch(err => console.error('Failed to load potholes data:', err));
    }
  }, [activeLayer, violationsLoaded, crimesLoaded, crashesLoaded, servicesLoaded, permitsLoaded, licensesLoaded, potholesLoaded]);

  const today = new Date();

  const isLive = (dateStr: string) => {
    const goLive = new Date(dateStr);
    return goLive <= today;
  };

  // Geocode address using Nominatim (free OpenStreetMap geocoding)
  const geocodeAddress = useCallback(async (address: string) => {
    setIsSearching(true);
    setSearchError(null);

    try {
      // Add Chicago, IL to help with geocoding accuracy
      const searchAddress = address.toLowerCase().includes('chicago')
        ? address
        : `${address}, Chicago, IL`;

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1&countrycodes=us`
      );

      if (!response.ok) {
        throw new Error('Geocoding service unavailable');
      }

      const results = await response.json();

      if (results.length === 0) {
        setSearchError('Address not found. Try a more specific address.');
        setUserLocation(null);
        return;
      }

      const result = results[0];
      setUserLocation({
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        address: result.display_name
      });

      // Clear selected cameras when searching for a new address
      setSelectedSpeedCamera(null);
      setSelectedRedLightCamera(null);

    } catch (error) {
      console.error('Geocoding error:', error);
      setSearchError('Failed to search address. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleAddressSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (addressSearchQuery.trim()) {
      geocodeAddress(addressSearchQuery.trim());
    }
  }, [addressSearchQuery, geocodeAddress]);

  const clearUserLocation = useCallback(() => {
    setUserLocation(null);
    setAddressSearchQuery('');
    setSearchError(null);
  }, []);

  // Filter speed cameras
  const filteredSpeedCameras = useMemo(() => {
    if (cameraFilter === 'redlight') return [];

    return SPEED_CAMERAS.filter(camera => {
      // Search filter
      const matchesSearch = cameraSearchQuery === '' ||
        camera.address.toLowerCase().includes(cameraSearchQuery.toLowerCase()) ||
        camera.locationId.toLowerCase().includes(cameraSearchQuery.toLowerCase());

      // Status filter
      let matchesStatus = true;
      if (statusFilter === 'active') {
        matchesStatus = isLive(camera.goLiveDate);
      } else if (statusFilter === 'upcoming') {
        matchesStatus = !isLive(camera.goLiveDate);
      }

      return matchesSearch && matchesStatus;
    });
  }, [cameraSearchQuery, statusFilter, cameraFilter]);

  // Filter red light cameras
  const filteredRedLightCameras = useMemo(() => {
    if (cameraFilter === 'speed') return [];

    return RED_LIGHT_CAMERAS.filter(camera => {
      // Search filter
      const matchesSearch = cameraSearchQuery === '' ||
        camera.intersection.toLowerCase().includes(cameraSearchQuery.toLowerCase());

      // Red light cameras are all active (no upcoming status)
      const matchesStatus = statusFilter !== 'upcoming';

      return matchesSearch && matchesStatus;
    });
  }, [cameraSearchQuery, statusFilter, cameraFilter]);

  // Calculate nearby cameras when user location is set
  const nearbyCameras = useMemo(() => {
    if (!userLocation) return { speed: 0, redLight: 0, total: 0 };

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3959; // Earth's radius in miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const speedNearby = SPEED_CAMERAS.filter(c =>
      calculateDistance(userLocation.latitude, userLocation.longitude, c.latitude, c.longitude) <= 1
    ).length;

    const redLightNearby = RED_LIGHT_CAMERAS.filter(c =>
      calculateDistance(userLocation.latitude, userLocation.longitude, c.latitude, c.longitude) <= 1
    ).length;

    return {
      speed: speedNearby,
      redLight: redLightNearby,
      total: speedNearby + redLightNearby
    };
  }, [userLocation]);

  // Calculate nearby violations when user location is set
  const nearbyViolations = useMemo(() => {
    if (!userLocation || violationBlocks.length === 0) {
      return { blocks: 0, violations: 0, highRisk: 0 };
    }

    const nearbyBlocks = getBlocksNearLocation(
      violationBlocks,
      userLocation.latitude,
      userLocation.longitude,
      1  // 1 mile radius
    );

    const stats = aggregateBlockStats(nearbyBlocks);
    return {
      blocks: stats.totalBlocks,
      violations: stats.totalViolations,
      highRisk: stats.highSeverityCount
    };
  }, [userLocation, violationBlocks]);

  // Calculate nearby crimes
  const nearbyCrimes = useMemo(() => {
    if (!userLocation || crimeBlocks.length === 0) {
      return { total: 0, violent: 0, property: 0 };
    }
    const nearby = getBlocksNear(crimeBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregateCrimeStats(nearby);
    return { total: stats.totalCrimes, violent: stats.violentCount, property: stats.propertyCount };
  }, [userLocation, crimeBlocks]);

  // Calculate nearby crashes
  const nearbyCrashes = useMemo(() => {
    if (!userLocation || crashBlocks.length === 0) {
      return { total: 0, injuries: 0, fatal: 0 };
    }
    const nearby = getBlocksNear(crashBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregateCrashStats(nearby);
    return { total: stats.totalCrashes, injuries: stats.totalInjuries, fatal: stats.totalFatal };
  }, [userLocation, crashBlocks]);

  // Calculate nearby 311 requests
  const nearbyServices = useMemo(() => {
    if (!userLocation || serviceBlocks.length === 0) {
      return { total: 0, recent: 0 };
    }
    const nearby = getBlocksNear(serviceBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregateServiceRequestStats(nearby);
    return { total: stats.totalRequests, recent: stats.recentRequests };
  }, [userLocation, serviceBlocks]);

  // Filter violations by category
  const filteredViolationBlocks = useMemo(() => {
    if (violationCategory === 'all') return violationBlocks;
    return violationBlocks.filter(block =>
      (block.categories[violationCategory] || 0) > 0
    );
  }, [violationBlocks, violationCategory]);

  // Filter crimes by category
  const filteredCrimeBlocks = useMemo(() => {
    if (crimeCategory === 'all') return crimeBlocks;
    return crimeBlocks.filter(block =>
      (block.categories[crimeCategory] || 0) > 0
    );
  }, [crimeBlocks, crimeCategory]);

  // Filter services by category
  const filteredServiceBlocks = useMemo(() => {
    if (serviceCategory === 'all') return serviceBlocks;
    return serviceBlocks.filter(block =>
      (block.categories[serviceCategory] || 0) > 0
    );
  }, [serviceBlocks, serviceCategory]);

  // Violation stats
  const violationStats = useMemo(() => {
    if (violationBlocks.length === 0) return null;
    return aggregateBlockStats(violationBlocks);
  }, [violationBlocks]);

  // Crime stats
  const crimeStats = useMemo(() => {
    if (crimeBlocks.length === 0) return null;
    return aggregateCrimeStats(crimeBlocks);
  }, [crimeBlocks]);

  // Crash stats
  const crashStats = useMemo(() => {
    if (crashBlocks.length === 0) return null;
    return aggregateCrashStats(crashBlocks);
  }, [crashBlocks]);

  // Service stats
  const serviceStats = useMemo(() => {
    if (serviceBlocks.length === 0) return null;
    return aggregateServiceRequestStats(serviceBlocks);
  }, [serviceBlocks]);

  // Calculate nearby permits
  const nearbyPermits = useMemo(() => {
    if (!userLocation || permitBlocks.length === 0) {
      return { total: 0, cost: 0, recent: 0 };
    }
    const nearby = getBlocksNear(permitBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregatePermitStats(nearby);
    return { total: stats.totalPermits, cost: stats.totalCost, recent: stats.recentPermits };
  }, [userLocation, permitBlocks]);

  // Calculate nearby licenses
  const nearbyLicenses = useMemo(() => {
    if (!userLocation || licenseBlocks.length === 0) {
      return { total: 0, active: 0 };
    }
    const nearby = getBlocksNear(licenseBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregateLicenseStats(nearby);
    return { total: stats.totalLicenses, active: stats.activeLicenses };
  }, [userLocation, licenseBlocks]);

  // Calculate nearby potholes
  const nearbyPotholes = useMemo(() => {
    if (!userLocation || potholeBlocks.length === 0) {
      return { repairs: 0, potholes: 0, recent: 0 };
    }
    const nearby = getBlocksNear(potholeBlocks, userLocation.latitude, userLocation.longitude, 1);
    const stats = aggregatePotholeStats(nearby);
    return { repairs: stats.totalRepairs, potholes: stats.totalPotholes, recent: stats.recentRepairs };
  }, [userLocation, potholeBlocks]);

  // Filter permits by category
  const filteredPermitBlocks = useMemo(() => {
    if (permitCategory === 'all') return permitBlocks;
    return permitBlocks.filter(block =>
      (block.categories[permitCategory] || 0) > 0
    );
  }, [permitBlocks, permitCategory]);

  // Filter licenses by category
  const filteredLicenseBlocks = useMemo(() => {
    if (licenseCategory === 'all') return licenseBlocks;
    return licenseBlocks.filter(block =>
      (block.categories[licenseCategory] || 0) > 0
    );
  }, [licenseBlocks, licenseCategory]);

  // Permit stats
  const permitStats = useMemo(() => {
    if (permitBlocks.length === 0) return null;
    return aggregatePermitStats(permitBlocks);
  }, [permitBlocks]);

  // License stats
  const licenseStats = useMemo(() => {
    if (licenseBlocks.length === 0) return null;
    return aggregateLicenseStats(licenseBlocks);
  }, [licenseBlocks]);

  // Pothole stats
  const potholeStats = useMemo(() => {
    if (potholeBlocks.length === 0) return null;
    return aggregatePotholeStats(potholeBlocks);
  }, [potholeBlocks]);

  const stats = useMemo(() => {
    const activeSpeed = SPEED_CAMERAS.filter(c => isLive(c.goLiveDate)).length;
    const upcomingSpeed = SPEED_CAMERAS.length - activeSpeed;
    const redLight = RED_LIGHT_CAMERAS.length;
    return {
      activeSpeed,
      upcomingSpeed,
      totalSpeed: SPEED_CAMERAS.length,
      redLight,
      total: SPEED_CAMERAS.length + redLight
    };
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <>
      <Head>
        <title>Chicago Camera Map - Speed & Red Light Cameras | Autopilot America</title>
        <meta name="description" content="Interactive map of all speed camera and red light camera locations in Chicago. Search your address to find nearby cameras and avoid tickets." />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', paddingBottom: '60px' }}>
        {/* Header */}
        <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '20px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'none',
                border: 'none',
                color: '#0052cc',
                cursor: 'pointer',
                fontSize: '14px',
                marginBottom: '10px'
              }}
            >
              &larr; Back to Home
            </button>
            <h1 style={{ margin: '0', fontSize: '32px', fontWeight: 'bold', color: '#111827' }}>
              Chicago Camera Map
            </h1>
            <p style={{ margin: '10px 0 0 0', color: '#6b7280', fontSize: '16px' }}>
              All {stats.total} photo-enforced camera locations in Chicago
            </p>
          </div>
        </div>

        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
          {/* Stats Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>TOTAL CAMERAS</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>
                {stats.total}
              </p>
            </div>
            <div style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              borderLeft: '4px solid #dc2626'
            }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>SPEED (ACTIVE)</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '28px', fontWeight: 'bold', color: '#dc2626' }}>
                {stats.activeSpeed}
              </p>
            </div>
            <div style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              borderLeft: '4px solid #f59e0b'
            }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>SPEED (SOON)</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '28px', fontWeight: 'bold', color: '#f59e0b' }}>
                {stats.upcomingSpeed}
              </p>
            </div>
            <div style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              borderLeft: '4px solid #7c3aed'
            }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>RED LIGHT</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '28px', fontWeight: 'bold', color: '#7c3aed' }}>
                {stats.redLight}
              </p>
            </div>
          </div>

          {/* Data Layer Selector */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>View:</span>
            {[
              { key: 'cameras', label: 'Cameras', color: '#dc2626' },
              { key: 'violations', label: 'Building Violations', color: '#f59e0b' },
              { key: 'crimes', label: 'Crime', color: '#7c3aed' },
              { key: 'crashes', label: 'Crashes', color: '#0ea5e9' },
              { key: '311', label: '311', color: '#22c55e' },
              { key: 'permits', label: 'Permits', color: '#10b981' },
              { key: 'licenses', label: 'Businesses', color: '#f97316' },
              { key: 'potholes', label: 'Potholes', color: '#6b7280' },
            ].map(layer => (
              <button
                key={layer.key}
                onClick={() => setActiveLayer(layer.key as DataLayer)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '20px',
                  border: activeLayer === layer.key ? `2px solid ${layer.color}` : '1px solid #d1d5db',
                  backgroundColor: activeLayer === layer.key ? layer.color : 'white',
                  color: activeLayer === layer.key ? 'white' : '#374151',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
              >
                {layer.label}
              </button>
            ))}
          </div>

          {/* Violations Stats & Filter */}
          {activeLayer === 'violations' && (
            <div style={{
              backgroundColor: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#92400e' }}>Building Violations Heat Map</span>
                {violationsLoaded && violationStats && (
                  <span style={{ fontSize: '12px', color: '#b45309', marginLeft: 'auto' }}>
                    {violationStats.totalViolations.toLocaleString()} violations across {violationStats.totalBlocks.toLocaleString()} areas
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(VIOLATION_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setViolationCategory(violationCategory === key ? 'all' : key as ViolationCategoryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      backgroundColor: violationCategory === key ? cat.color : 'white',
                      color: violationCategory === key ? 'white' : '#374151',
                      border: `1px solid ${cat.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {cat.shortName}
                  </button>
                ))}
              </div>
              {userLocation && nearbyViolations.violations > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#fffbeb', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyViolations.violations.toLocaleString()}</strong> violations within 1 mile
                  {nearbyViolations.highRisk > 0 && <span style={{ color: '#dc2626' }}> ({nearbyViolations.highRisk} high-risk areas)</span>}
                </div>
              )}
            </div>
          )}

          {/* Crimes Stats & Filter */}
          {activeLayer === 'crimes' && (
            <div style={{
              backgroundColor: '#f3e8ff',
              border: '1px solid #7c3aed',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#5b21b6' }}>Crime Heat Map (Last 12 Months)</span>
                {crimesLoaded && crimeStats && (
                  <span style={{ fontSize: '12px', color: '#7c3aed', marginLeft: 'auto' }}>
                    {crimeStats.totalCrimes.toLocaleString()} crimes across {crimeStats.totalBlocks.toLocaleString()} areas
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(CRIME_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setCrimeCategory(crimeCategory === key ? 'all' : key as CrimeCategoryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      backgroundColor: crimeCategory === key ? cat.color : 'white',
                      color: crimeCategory === key ? 'white' : '#374151',
                      border: `1px solid ${cat.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {cat.shortName}
                  </button>
                ))}
              </div>
              {userLocation && nearbyCrimes.total > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#faf5ff', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyCrimes.total.toLocaleString()}</strong> crimes within 1 mile
                  {nearbyCrimes.violent > 0 && <span style={{ color: '#dc2626' }}> ({nearbyCrimes.violent} violent)</span>}
                </div>
              )}
            </div>
          )}

          {/* Crashes Stats */}
          {activeLayer === 'crashes' && (
            <div style={{
              backgroundColor: '#ecfeff',
              border: '1px solid #0ea5e9',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#0369a1' }}>Traffic Crash Heat Map</span>
                {crashesLoaded && crashStats && (
                  <span style={{ fontSize: '12px', color: '#0ea5e9', marginLeft: 'auto' }}>
                    {crashStats.totalCrashes.toLocaleString()} crashes | {crashStats.totalInjuries.toLocaleString()} injuries | {crashStats.totalFatal} fatal
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: '#0369a1' }}>
                Circles sized by crash count, colored by danger score (injuries, fatalities)
              </div>
              {userLocation && nearbyCrashes.total > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyCrashes.total.toLocaleString()}</strong> crashes within 1 mile
                  {nearbyCrashes.injuries > 0 && <span> ({nearbyCrashes.injuries} injuries)</span>}
                  {nearbyCrashes.fatal > 0 && <span style={{ color: '#dc2626' }}> ({nearbyCrashes.fatal} fatal)</span>}
                </div>
              )}
            </div>
          )}

          {/* 311 Service Requests Stats */}
          {activeLayer === '311' && (
            <div style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #22c55e',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#166534' }}>311 Service Requests Heat Map</span>
                {servicesLoaded && serviceStats && (
                  <span style={{ fontSize: '12px', color: '#22c55e', marginLeft: 'auto' }}>
                    {serviceStats.totalRequests.toLocaleString()} requests across {serviceStats.totalBlocks.toLocaleString()} areas
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(SERVICE_REQUEST_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setServiceCategory(serviceCategory === key ? 'all' : key as ServiceRequestCategoryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      backgroundColor: serviceCategory === key ? cat.color : 'white',
                      color: serviceCategory === key ? 'white' : '#374151',
                      border: `1px solid ${cat.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {cat.shortName}
                  </button>
                ))}
              </div>
              {userLocation && nearbyServices.total > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#f0fdf4', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyServices.total.toLocaleString()}</strong> service requests within 1 mile
                  {nearbyServices.recent > 0 && <span> ({nearbyServices.recent} in last 90 days)</span>}
                </div>
              )}
            </div>
          )}

          {/* Building Permits Stats */}
          {activeLayer === 'permits' && (
            <div style={{
              backgroundColor: '#ecfdf5',
              border: '1px solid #10b981',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#065f46' }}>Building Permits Heat Map</span>
                {permitsLoaded && permitStats && (
                  <span style={{ fontSize: '12px', color: '#10b981', marginLeft: 'auto' }}>
                    {permitStats.totalPermits.toLocaleString()} permits | ${(permitStats.totalCost / 1000000000).toFixed(1)}B total value
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(PERMIT_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setPermitCategory(permitCategory === key ? 'all' : key as PermitCategoryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      backgroundColor: permitCategory === key ? cat.color : 'white',
                      color: permitCategory === key ? 'white' : '#374151',
                      border: `1px solid ${cat.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {cat.shortName}
                  </button>
                ))}
              </div>
              {userLocation && nearbyPermits.total > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#f0fdf9', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyPermits.total.toLocaleString()}</strong> permits within 1 mile
                  {nearbyPermits.recent > 0 && <span> ({nearbyPermits.recent} in last year)</span>}
                </div>
              )}
            </div>
          )}

          {/* Business Licenses Stats */}
          {activeLayer === 'licenses' && (
            <div style={{
              backgroundColor: '#fff7ed',
              border: '1px solid #f97316',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#c2410c' }}>Business Licenses Heat Map</span>
                {licensesLoaded && licenseStats && (
                  <span style={{ fontSize: '12px', color: '#f97316', marginLeft: 'auto' }}>
                    {licenseStats.totalLicenses.toLocaleString()} licenses | {licenseStats.activeLicenses.toLocaleString()} active
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(LICENSE_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setLicenseCategory(licenseCategory === key ? 'all' : key as LicenseCategoryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      backgroundColor: licenseCategory === key ? cat.color : 'white',
                      color: licenseCategory === key ? 'white' : '#374151',
                      border: `1px solid ${cat.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {cat.shortName}
                  </button>
                ))}
              </div>
              {userLocation && nearbyLicenses.total > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#fffbeb', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyLicenses.total.toLocaleString()}</strong> business licenses within 1 mile
                  {nearbyLicenses.active > 0 && <span> ({nearbyLicenses.active} active)</span>}
                </div>
              )}
            </div>
          )}

          {/* Potholes Stats */}
          {activeLayer === 'potholes' && (
            <div style={{
              backgroundColor: '#f9fafb',
              border: '1px solid #6b7280',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: '600', color: '#374151' }}>Potholes Patched Heat Map</span>
                {potholesLoaded && potholeStats && (
                  <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: 'auto' }}>
                    {potholeStats.totalPotholes.toLocaleString()} potholes filled | {potholeStats.totalRepairs.toLocaleString()} repair visits
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                Shows road maintenance activity - larger circles = more repairs needed
              </div>
              {userLocation && nearbyPotholes.potholes > 0 && (
                <div style={{ marginTop: '12px', padding: '8px 12px', backgroundColor: '#f3f4f6', borderRadius: '8px', fontSize: '12px' }}>
                  <strong>{nearbyPotholes.potholes.toLocaleString()}</strong> potholes filled within 1 mile
                  {nearbyPotholes.recent > 0 && <span> ({nearbyPotholes.recent} in last 90 days)</span>}
                </div>
              )}
            </div>
          )}

          {/* Camera Type Filter & Search */}
          {activeLayer === 'cameras' && (
          <div style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            <div style={{
              display: 'flex',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #d1d5db'
            }}>
              <button
                onClick={() => setCameraFilter('all')}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  backgroundColor: cameraFilter === 'all' ? '#111827' : 'white',
                  color: cameraFilter === 'all' ? 'white' : '#374151',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                All Cameras
              </button>
              <button
                onClick={() => setCameraFilter('speed')}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  borderLeft: '1px solid #d1d5db',
                  backgroundColor: cameraFilter === 'speed' ? '#dc2626' : 'white',
                  color: cameraFilter === 'speed' ? 'white' : '#374151',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Speed
              </button>
              <button
                onClick={() => setCameraFilter('redlight')}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  borderLeft: '1px solid #d1d5db',
                  backgroundColor: cameraFilter === 'redlight' ? '#7c3aed' : 'white',
                  color: cameraFilter === 'redlight' ? 'white' : '#374151',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Red Light
              </button>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="upcoming">Coming Soon</option>
            </select>

            <input
              type="text"
              placeholder="Search camera locations..."
              value={cameraSearchQuery}
              onChange={(e) => setCameraSearchQuery(e.target.value)}
              style={{
                flex: '1',
                minWidth: '200px',
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px'
              }}
            />
          </div>
          )}

          {/* Info Banners */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              padding: '16px'
            }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#991b1b', fontSize: '14px' }}>
                Speed Camera Fines
              </p>
              <p style={{ margin: '0', fontSize: '13px', color: '#991b1b' }}>
                6-10 mph over: <strong>$35</strong> | 11+ mph over: <strong>$100</strong>
                <br />
                <span style={{ fontSize: '12px' }}>Active in school/park zones. 2nd violation doubles fine.</span>
              </p>
            </div>
            <div style={{
              backgroundColor: '#f5f3ff',
              border: '1px solid #ddd6fe',
              borderRadius: '12px',
              padding: '16px'
            }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#5b21b6', fontSize: '14px' }}>
                Red Light Camera Fines
              </p>
              <p style={{ margin: '0', fontSize: '13px', color: '#5b21b6' }}>
                Standard: <strong>$100</strong> | School zone: <strong>$200+</strong>
                <br />
                <span style={{ fontSize: '12px' }}>Applies to running red lights at intersections.</span>
              </p>
            </div>
          </div>

          {/* Map and List Container */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 380px',
            gap: '24px'
          }} className="map-list-container">
            {/* Map */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              height: '600px'
            }}>
              <CameraMap
                speedCameras={filteredSpeedCameras}
                redLightCameras={filteredRedLightCameras}
                selectedSpeedCamera={selectedSpeedCamera}
                selectedRedLightCamera={selectedRedLightCamera}
                userLocation={userLocation}
                onSpeedCameraSelect={(camera) => {
                  setSelectedSpeedCamera(camera);
                  setSelectedRedLightCamera(null);
                }}
                onRedLightCameraSelect={(camera) => {
                  setSelectedRedLightCamera(camera);
                  setSelectedSpeedCamera(null);
                }}
                showSpeedCameras={activeLayer === 'cameras' && cameraFilter !== 'redlight'}
                showRedLightCameras={activeLayer === 'cameras' && cameraFilter !== 'speed'}
                violationBlocks={filteredViolationBlocks}
                showViolations={activeLayer === 'violations'}
                selectedViolationCategory={violationCategory}
                crimeBlocks={filteredCrimeBlocks}
                showCrimes={activeLayer === 'crimes'}
                selectedCrimeCategory={crimeCategory}
                crashBlocks={crashBlocks}
                showCrashes={activeLayer === 'crashes'}
                serviceBlocks={filteredServiceBlocks}
                showServices={activeLayer === '311'}
                selectedServiceCategory={serviceCategory}
                permitBlocks={filteredPermitBlocks}
                showPermits={activeLayer === 'permits'}
                selectedPermitCategory={permitCategory}
                licenseBlocks={filteredLicenseBlocks}
                showLicenses={activeLayer === 'licenses'}
                selectedLicenseCategory={licenseCategory}
                potholeBlocks={potholeBlocks}
                showPotholes={activeLayer === 'potholes'}
              />
            </div>

            {/* Camera List */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: '600px'
            }}>
              <div style={{
                padding: '16px',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb'
              }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                  Camera Locations ({filteredSpeedCameras.length + filteredRedLightCameras.length})
                </h3>
              </div>
              <div style={{
                flex: 1,
                overflowY: 'auto'
              }}>
                {/* Speed Cameras */}
                {filteredSpeedCameras.map((camera) => (
                  <div
                    key={`speed-${camera.id}`}
                    onClick={() => {
                      setSelectedSpeedCamera(camera);
                      setSelectedRedLightCamera(null);
                    }}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      backgroundColor: selectedSpeedCamera?.id === camera.id ? '#fef2f2' : 'transparent',
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSpeedCamera?.id !== camera.id) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSpeedCamera?.id !== camera.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <span style={{
                            backgroundColor: '#dc2626',
                            color: 'white',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '9px',
                            fontWeight: 'bold'
                          }}>
                            SPEED
                          </span>
                          <span style={{ fontWeight: '600', fontSize: '13px', color: '#111827' }}>
                            {camera.address}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>
                          {camera.locationId} | {camera.firstApproach}
                          {camera.secondApproach && `, ${camera.secondApproach}`}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '9px',
                        fontWeight: '600',
                        color: isLive(camera.goLiveDate) ? '#dc2626' : '#f59e0b',
                        backgroundColor: isLive(camera.goLiveDate) ? '#fef2f2' : '#fffbeb',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginLeft: '8px',
                        whiteSpace: 'nowrap'
                      }}>
                        {isLive(camera.goLiveDate) ? 'ACTIVE' : formatDate(camera.goLiveDate)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Red Light Cameras */}
                {filteredRedLightCameras.map((camera) => (
                  <div
                    key={`redlight-${camera.id}`}
                    onClick={() => {
                      setSelectedRedLightCamera(camera);
                      setSelectedSpeedCamera(null);
                    }}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      backgroundColor: selectedRedLightCamera?.id === camera.id ? '#f5f3ff' : 'transparent',
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedRedLightCamera?.id !== camera.id) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedRedLightCamera?.id !== camera.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <span style={{
                            backgroundColor: '#7c3aed',
                            color: 'white',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '9px',
                            fontWeight: 'bold'
                          }}>
                            RED LIGHT
                          </span>
                          <span style={{ fontWeight: '600', fontSize: '13px', color: '#111827' }}>
                            {camera.intersection}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>
                          {camera.firstApproach || 'N/A'}
                          {camera.secondApproach && `, ${camera.secondApproach}`}
                          {camera.thirdApproach && `, ${camera.thirdApproach}`}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '9px',
                        fontWeight: '600',
                        color: '#7c3aed',
                        backgroundColor: '#f5f3ff',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginLeft: '8px'
                      }}>
                        ACTIVE
                      </span>
                    </div>
                  </div>
                ))}

                {filteredSpeedCameras.length === 0 && filteredRedLightCameras.length === 0 && (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
                    No cameras match your filters
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Data Source */}
          <div style={{
            marginTop: '24px',
            padding: '16px',
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>Data Source:</strong> Chicago Data Portal - Speed Camera Locations & Red Light Camera Locations.
            Last updated: December 2024. Data is provided by the City of Chicago.
          </div>
        </div>
      </div>

      <Footer />

      <style jsx global>{`
        @media (max-width: 900px) {
          .map-list-container {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
