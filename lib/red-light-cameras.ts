// Red Light Camera data from Chicago Data Portal
// Last updated: December 2024

export interface RedLightCamera {
  id: string;
  intersection: string;
  firstApproach: string | null;
  secondApproach: string | null;
  thirdApproach: string | null;
  goLiveDate: string;
  latitude: number;
  longitude: number;
}

export const RED_LIGHT_CAMERAS: RedLightCamera[] = [
  {
    "id": "1",
    "intersection": "2400 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-03",
    "latitude": 41.92431,
    "longitude": -87.7661
  },
  {
    "id": "2",
    "intersection": "800 North Western Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.89543,
    "longitude": -87.6867
  },
  {
    "id": "3",
    "intersection": "6400 West Fullerton Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-13",
    "latitude": 41.92356,
    "longitude": -87.78583
  },
  {
    "id": "4",
    "intersection": "5600 West Diversey Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-17",
    "latitude": 41.93136,
    "longitude": -87.76588
  },
  {
    "id": "5",
    "intersection": "2400 West Addison",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-07",
    "latitude": 41.94665,
    "longitude": -87.6887
  },
  {
    "id": "6",
    "intersection": "2400 West Foster Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-04",
    "latitude": 41.97598,
    "longitude": -87.6887
  },
  {
    "id": "7",
    "intersection": "3200 North Pulaski Rd",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-17",
    "latitude": 41.93935,
    "longitude": -87.72729
  },
  {
    "id": "8",
    "intersection": "6000 W Addison Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-27",
    "latitude": 41.94574,
    "longitude": -87.77688
  },
  {
    "id": "9",
    "intersection": "11900 South Halsted",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-01",
    "latitude": 41.67812,
    "longitude": -87.64206
  },
  {
    "id": "10",
    "intersection": "4800 West Diversey Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-02-10",
    "latitude": 41.93154,
    "longitude": -87.74614
  },
  {
    "id": "11",
    "intersection": "6400 West Fullerton Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-13",
    "latitude": 41.92381,
    "longitude": -87.7847
  },
  {
    "id": "12",
    "intersection": "7600 South Stony Island Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-28",
    "latitude": 41.75671,
    "longitude": -87.58561
  },
  {
    "id": "13",
    "intersection": "2400 North Ashland Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-07",
    "latitude": 41.92528,
    "longitude": -87.66819
  },
  {
    "id": "14",
    "intersection": "1 East 79th Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-25",
    "latitude": 41.75105,
    "longitude": -87.62419
  },
  {
    "id": "15",
    "intersection": "1300 W Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-21",
    "latitude": 41.95432,
    "longitude": -87.66262
  },
  {
    "id": "16",
    "intersection": "2400 North Ashland Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-06",
    "latitude": 41.92499,
    "longitude": -87.66808
  },
  {
    "id": "17",
    "intersection": "6300 South Kedzie Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-24",
    "latitude": 41.77869,
    "longitude": -87.70305
  },
  {
    "id": "18",
    "intersection": "3200 North Kedzie Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-02-28",
    "latitude": 41.93878,
    "longitude": -87.70765
  },
  {
    "id": "19",
    "intersection": "600 South Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-11-17",
    "latitude": 41.8735,
    "longitude": -87.74513
  },
  {
    "id": "20",
    "intersection": "�200 N. Upper Wacker Dr",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-02-18",
    "latitude": 41.88547,
    "longitude": -87.63681
  },
  {
    "id": "21",
    "intersection": "3200 West 55th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-21",
    "latitude": 41.79345,
    "longitude": -87.70393
  },
  {
    "id": "22",
    "intersection": "5500 S. Pulaski",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-17",
    "latitude": 41.7937,
    "longitude": -87.72329
  },
  {
    "id": "23",
    "intersection": "5075 West Montrose Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-03-10",
    "latitude": 41.96066,
    "longitude": -87.75406
  },
  {
    "id": "24",
    "intersection": "400 West Belmont Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-21",
    "latitude": 41.94017,
    "longitude": -87.6389
  },
  {
    "id": "25",
    "intersection": "7100 South Cottage Grove Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-28",
    "latitude": 41.76515,
    "longitude": -87.60543
  },
  {
    "id": "26",
    "intersection": "150 North Sacramento Boulevard",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-16",
    "latitude": 41.89529,
    "longitude": -87.70209
  },
  {
    "id": "27",
    "intersection": "3700 West Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-11",
    "latitude": 41.95376,
    "longitude": -87.719
  },
  {
    "id": "28",
    "intersection": "8700 South Vincennes",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-09",
    "latitude": 41.73643,
    "longitude": -87.6451
  },
  {
    "id": "29",
    "intersection": "4000 West Diversey Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-05-14",
    "latitude": 41.93177,
    "longitude": -87.72741
  },
  {
    "id": "30",
    "intersection": "3600 North Harlem Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-19",
    "latitude": 41.94493,
    "longitude": -87.80688
  },
  {
    "id": "31",
    "intersection": "4400 North Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.961,
    "longitude": -87.68862
  },
  {
    "id": "32",
    "intersection": "4700 S. Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-28",
    "latitude": 41.80813,
    "longitude": -87.6843
  },
  {
    "id": "33",
    "intersection": "3200 North Lakeshore Drive",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-20",
    "latitude": 41.94035,
    "longitude": -87.63887
  },
  {
    "id": "34",
    "intersection": "5500 South Kedzie Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-21",
    "latitude": 41.79373,
    "longitude": -87.70362
  },
  {
    "id": "35",
    "intersection": "1200 West Devon Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.99813,
    "longitude": -87.66099
  },
  {
    "id": "36",
    "intersection": "4000 N Clark Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-20",
    "latitude": 41.95417,
    "longitude": -87.66199
  },
  {
    "id": "37",
    "intersection": "848 West 87th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-10",
    "latitude": 41.73602,
    "longitude": -87.64556
  },
  {
    "id": "38",
    "intersection": "4800 West Chicago Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-04",
    "latitude": 41.89494,
    "longitude": -87.74609
  },
  {
    "id": "39",
    "intersection": "6300 South Pulaski Rd",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-03-29",
    "latitude": 41.77891,
    "longitude": -87.72291
  },
  {
    "id": "40",
    "intersection": "4400 West Ogden Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-22",
    "latitude": 41.84747,
    "longitude": -87.73476
  },
  {
    "id": "41",
    "intersection": "4800 North Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-29",
    "latitude": 41.96898,
    "longitude": -87.68897
  },
  {
    "id": "42",
    "intersection": "4440 West Lawrence Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-07",
    "latitude": 41.96817,
    "longitude": -87.73976
  },
  {
    "id": "43",
    "intersection": "1600 East 79th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.75155,
    "longitude": -87.58502
  },
  {
    "id": "44",
    "intersection": "0 N. Ashland Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-04",
    "latitude": 41.88122,
    "longitude": -87.66663
  },
  {
    "id": "45",
    "intersection": "7100 S. Ashland",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-09",
    "latitude": 41.76456,
    "longitude": -87.66366
  },
  {
    "id": "46",
    "intersection": "2000 West Division",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-12-27",
    "latitude": 41.90316,
    "longitude": -87.67749
  },
  {
    "id": "47",
    "intersection": "800 West 79th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-29",
    "latitude": 41.75059,
    "longitude": -87.64443
  },
  {
    "id": "48",
    "intersection": "800 West Fullerton Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-30",
    "latitude": 41.92549,
    "longitude": -87.64842
  },
  {
    "id": "49",
    "intersection": "4000 W. 55th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-18",
    "latitude": 41.79326,
    "longitude": -87.72274
  },
  {
    "id": "50",
    "intersection": "5930 N Clark Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-21",
    "latitude": 41.98922,
    "longitude": -87.66979
  },
  {
    "id": "51",
    "intersection": "1600 West 87th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-03-30",
    "latitude": 41.73582,
    "longitude": -87.66262
  },
  {
    "id": "52",
    "intersection": "2000 East 95th St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-25",
    "latitude": 41.72249,
    "longitude": -87.57581
  },
  {
    "id": "53",
    "intersection": "4000 West Foster Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.97559,
    "longitude": -87.72792
  },
  {
    "id": "54",
    "intersection": "1200 North Pulaski Road",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-20",
    "latitude": 41.9025,
    "longitude": -87.72621
  },
  {
    "id": "55",
    "intersection": "800 West North Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-28",
    "latitude": 41.91095,
    "longitude": -87.64784
  },
  {
    "id": "56",
    "intersection": "2800 N Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-16",
    "latitude": 41.93182,
    "longitude": -87.6878
  },
  {
    "id": "57",
    "intersection": "800 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-05-26",
    "latitude": 41.89513,
    "longitude": -87.7655
  },
  {
    "id": "58",
    "intersection": "2400 West North Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-25",
    "latitude": 41.91026,
    "longitude": -87.68769
  },
  {
    "id": "59",
    "intersection": "3200 West Armitage Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-01-22",
    "latitude": 41.91744,
    "longitude": -87.70668
  },
  {
    "id": "60",
    "intersection": "1200 South Canal Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.86693,
    "longitude": -87.63912
  },
  {
    "id": "61",
    "intersection": "4000 West Armitage Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.9172,
    "longitude": -87.72625
  },
  {
    "id": "62",
    "intersection": "7900 S. South Chicago Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-05",
    "latitude": 41.75126,
    "longitude": -87.5851
  },
  {
    "id": "63",
    "intersection": "100 West Chicago Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-10-21",
    "latitude": 41.89659,
    "longitude": -87.63142
  },
  {
    "id": "64",
    "intersection": "5600 West Fullerton Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-04",
    "latitude": 41.92414,
    "longitude": -87.7656
  },
  {
    "id": "65",
    "intersection": "3200 W. Belmont",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-02-29",
    "latitude": 41.93968,
    "longitude": -87.70771
  },
  {
    "id": "66",
    "intersection": "2400 North Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-28",
    "latitude": 41.92459,
    "longitude": -87.68757
  },
  {
    "id": "67",
    "intersection": "3200 West 47th ST",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-03-29",
    "latitude": 41.80821,
    "longitude": -87.70362
  },
  {
    "id": "68",
    "intersection": "3200 N. Kedzie Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-02-29",
    "latitude": 41.93945,
    "longitude": -87.7078
  },
  {
    "id": "69",
    "intersection": "6400 North California Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-30",
    "latitude": 41.9973,
    "longitude": -87.69958
  },
  {
    "id": "70",
    "intersection": "2348 South Kostner Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-22",
    "latitude": 41.84804,
    "longitude": -87.73451
  },
  {
    "id": "71",
    "intersection": "4000 W Lawrence Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-30",
    "latitude": 41.96819,
    "longitude": -87.72843
  },
  {
    "id": "72",
    "intersection": "1600 N. Kostner",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-09",
    "latitude": 41.90956,
    "longitude": -87.73627
  },
  {
    "id": "73",
    "intersection": "1600 West Lawrence Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-26",
    "latitude": 41.96882,
    "longitude": -87.66992
  },
  {
    "id": "74",
    "intersection": "4800 West Peterson Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.99,
    "longitude": -87.74784
  },
  {
    "id": "75",
    "intersection": "2800 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-17",
    "latitude": 41.93157,
    "longitude": -87.76635
  },
  {
    "id": "76",
    "intersection": "7200 West Addison",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-20",
    "latitude": 41.9452,
    "longitude": -87.8075
  },
  {
    "id": "77",
    "intersection": "3000 West Chicago Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-16",
    "latitude": 41.89564,
    "longitude": -87.70195
  },
  {
    "id": "78",
    "intersection": "4400 W. North",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-10",
    "latitude": 41.90973,
    "longitude": -87.73652
  },
  {
    "id": "79",
    "intersection": "9900 South Halsted St",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2005-12-30",
    "latitude": 41.71402,
    "longitude": -87.6428
  },
  {
    "id": "80",
    "intersection": "1600 North Western Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-24",
    "latitude": 41.91014,
    "longitude": -87.68715
  },
  {
    "id": "81",
    "intersection": "6400 North Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-29",
    "latitude": 41.99745,
    "longitude": -87.6898
  },
  {
    "id": "82",
    "intersection": "30 West 87th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-30",
    "latitude": 41.7362,
    "longitude": -87.62583
  },
  {
    "id": "83",
    "intersection": "2800 West Diversey",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-30",
    "latitude": 41.92331,
    "longitude": -87.69719
  },
  {
    "id": "84",
    "intersection": "1900 North Ashland Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-25",
    "latitude": 41.9159,
    "longitude": -87.66777
  },
  {
    "id": "85",
    "intersection": "2400 West 63rd St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-11",
    "latitude": 41.77921,
    "longitude": -87.68403
  },
  {
    "id": "86",
    "intersection": "2000 W Diversey Parkway",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-29",
    "latitude": 41.9323,
    "longitude": -87.67803
  },
  {
    "id": "87",
    "intersection": "2000 North Kedzie Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-01-21",
    "latitude": 41.91757,
    "longitude": -87.70707
  },
  {
    "id": "88",
    "intersection": "7200 North Western Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-19",
    "latitude": 42.01199,
    "longitude": -87.69015
  },
  {
    "id": "89",
    "intersection": "2800 West Devon Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-30",
    "latitude": 41.99752,
    "longitude": -87.69997
  },
  {
    "id": "90",
    "intersection": "2800 North Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-02-09",
    "latitude": 41.93127,
    "longitude": -87.74651
  },
  {
    "id": "91",
    "intersection": "4200 South Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-04-27",
    "latitude": 41.81709,
    "longitude": -87.74322
  },
  {
    "id": "92",
    "intersection": "5200 North Broadway St",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-16",
    "latitude": 41.97605,
    "longitude": -87.65979
  },
  {
    "id": "93",
    "intersection": "2400 W Diversey Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-17",
    "latitude": 41.93229,
    "longitude": -87.68739
  },
  {
    "id": "94",
    "intersection": "4000 West Belmont Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-18",
    "latitude": 41.93901,
    "longitude": -87.72757
  },
  {
    "id": "95",
    "intersection": "2400 West Cermak Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-12-28",
    "latitude": 41.85196,
    "longitude": -87.68613
  },
  {
    "id": "96",
    "intersection": "6000 North Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.9903,
    "longitude": -87.74836
  },
  {
    "id": "97",
    "intersection": "2400 West Montrose Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.96135,
    "longitude": -87.6883
  },
  {
    "id": "98",
    "intersection": "8700 South Lafayette Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-29",
    "latitude": 41.73666,
    "longitude": -87.62552
  },
  {
    "id": "99",
    "intersection": "2600 South Kedzie Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-11-01",
    "latitude": 41.84478,
    "longitude": -87.70512
  },
  {
    "id": "100",
    "intersection": "4800 West Harrison Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-11-18",
    "latitude": 41.87305,
    "longitude": -87.74539
  },
  {
    "id": "101",
    "intersection": "3200 North Harlem Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-16",
    "latitude": 41.93766,
    "longitude": -87.80668
  },
  {
    "id": "102",
    "intersection": "1000 West Foster Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-01-25",
    "latitude": 41.97645,
    "longitude": -87.65452
  },
  {
    "id": "103",
    "intersection": "3600 North Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-28",
    "latitude": 41.94579,
    "longitude": -87.74696
  },
  {
    "id": "104",
    "intersection": "1 East 75th Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-27",
    "latitude": 41.75823,
    "longitude": -87.62424
  },
  {
    "id": "105",
    "intersection": "800 West Roosevelt Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-13",
    "latitude": 41.86703,
    "longitude": -87.64739
  },
  {
    "id": "106",
    "intersection": "5600 West Belmont Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-02-03",
    "latitude": 41.93868,
    "longitude": -87.76606
  },
  {
    "id": "107",
    "intersection": "4000 N Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-28",
    "latitude": 41.95348,
    "longitude": -87.76704
  },
  {
    "id": "108",
    "intersection": "1600 North Homan Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-04",
    "latitude": 41.90982,
    "longitude": -87.71185
  },
  {
    "id": "109",
    "intersection": "800 North Sacramento Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-10-18",
    "latitude": 41.88375,
    "longitude": -87.70118
  },
  {
    "id": "110",
    "intersection": "3216 West Addison St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-18",
    "latitude": 41.94653,
    "longitude": -87.70919
  },
  {
    "id": "111",
    "intersection": "4700 South Cicero Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-03-29",
    "latitude": 41.80796,
    "longitude": -87.74333
  },
  {
    "id": "112",
    "intersection": "5000 South Archer Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-29",
    "latitude": 41.80194,
    "longitude": -87.72385
  },
  {
    "id": "113",
    "intersection": "2400 North Clark St",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-25",
    "latitude": 41.92504,
    "longitude": -87.64018
  },
  {
    "id": "114",
    "intersection": "5930 N Clark Street",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-22",
    "latitude": 41.99019,
    "longitude": -87.67017
  },
  {
    "id": "115",
    "intersection": "2400 West 79th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.75014,
    "longitude": -87.6824
  },
  {
    "id": "116",
    "intersection": "3600 North Elston Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.94686,
    "longitude": -87.70926
  },
  {
    "id": "117",
    "intersection": "6400 North Sheridan Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.99852,
    "longitude": -87.66062
  },
  {
    "id": "118",
    "intersection": "�628 N. Michigan Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-21",
    "latitude": 41.89368,
    "longitude": -87.62433
  },
  {
    "id": "119",
    "intersection": "2400 N Laramie Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-27",
    "latitude": 41.92385,
    "longitude": -87.75611
  },
  {
    "id": "120",
    "intersection": "4800 North Elston Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-06",
    "latitude": 41.9679,
    "longitude": -87.73976
  },
  {
    "id": "121",
    "intersection": "5200 West Madison Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2011-05-10",
    "latitude": 41.88026,
    "longitude": -87.75554
  },
  {
    "id": "122",
    "intersection": "1200 South Pulaski Road",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-15",
    "latitude": 41.86586,
    "longitude": -87.72508
  },
  {
    "id": "123",
    "intersection": "4000 North Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-05-18",
    "latitude": 41.95398,
    "longitude": -87.72769
  },
  {
    "id": "124",
    "intersection": "1 S. Western Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-05-30",
    "latitude": 41.88092,
    "longitude": -87.68626
  },
  {
    "id": "125",
    "intersection": "�300 S. Michigan Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-22",
    "latitude": 41.87795,
    "longitude": -87.62412
  },
  {
    "id": "126",
    "intersection": "1600 West Cortland St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-25",
    "latitude": 41.91607,
    "longitude": -87.66832
  },
  {
    "id": "127",
    "intersection": "9500 South Jeffery Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-25",
    "latitude": 41.72281,
    "longitude": -87.57541
  },
  {
    "id": "128",
    "intersection": "3500 S. Western",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-10",
    "latitude": 41.83059,
    "longitude": -87.68515
  },
  {
    "id": "129",
    "intersection": "500 North Columbus Drive",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-10-27",
    "latitude": 41.89073,
    "longitude": -87.62014
  },
  {
    "id": "130",
    "intersection": "500 West Roosevelt Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.86737,
    "longitude": -87.6387
  },
  {
    "id": "131",
    "intersection": "500 North Columbus Drive",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-10-27",
    "latitude": 41.89121,
    "longitude": -87.62023
  },
  {
    "id": "132",
    "intersection": "3600 North Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-06",
    "latitude": 41.94652,
    "longitude": -87.68803
  },
  {
    "id": "133",
    "intersection": "100 North Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-13",
    "latitude": 41.88216,
    "longitude": -87.74545
  },
  {
    "id": "134",
    "intersection": "6700 South Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-28",
    "latitude": 41.77225,
    "longitude": -87.68358
  },
  {
    "id": "135",
    "intersection": "1200 S. Kostner",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-16",
    "latitude": 41.86578,
    "longitude": -87.73486
  },
  {
    "id": "136",
    "intersection": "5200 West Irving Park Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-01-26",
    "latitude": 41.95338,
    "longitude": -87.75672
  },
  {
    "id": "137",
    "intersection": "2000 West Division",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-12-28",
    "latitude": 41.90323,
    "longitude": -87.67686
  },
  {
    "id": "138",
    "intersection": "6400 North Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-30",
    "latitude": 41.99803,
    "longitude": -87.68997
  },
  {
    "id": "139",
    "intersection": "5200 South Cicero Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-11",
    "latitude": 41.79817,
    "longitude": -87.74373
  },
  {
    "id": "140",
    "intersection": "3200 West 63rd St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-25",
    "latitude": 41.77903,
    "longitude": -87.70277
  },
  {
    "id": "141",
    "intersection": "800 West 111th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2005-12-31",
    "latitude": 41.69254,
    "longitude": -87.64193
  },
  {
    "id": "142",
    "intersection": "3100 S Dr Martin L King",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-20",
    "latitude": 41.83813,
    "longitude": -87.61723
  },
  {
    "id": "143",
    "intersection": "4800 N Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-29",
    "latitude": 41.96852,
    "longitude": -87.72811
  },
  {
    "id": "144",
    "intersection": "6300 South Damen Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.77954,
    "longitude": -87.67397
  },
  {
    "id": "145",
    "intersection": "4400 W. Roosevelt",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-17",
    "latitude": 41.86595,
    "longitude": -87.73539
  },
  {
    "id": "146",
    "intersection": "7200 North Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-20",
    "latitude": 42.0126,
    "longitude": -87.69031
  },
  {
    "id": "147",
    "intersection": "2200 S. Pulaski",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-09",
    "latitude": 41.85195,
    "longitude": -87.72489
  },
  {
    "id": "148",
    "intersection": "100 West Chicago Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-10-20",
    "latitude": 41.89667,
    "longitude": -87.63101
  },
  {
    "id": "149",
    "intersection": "2400 North Pulaski Rd",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-17",
    "latitude": 41.92416,
    "longitude": -87.72677
  },
  {
    "id": "150",
    "intersection": "2400 West Chicago Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.8957,
    "longitude": -87.68737
  },
  {
    "id": "151",
    "intersection": "1 North Halsted Street",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-13",
    "latitude": 41.88207,
    "longitude": -87.64748
  },
  {
    "id": "152",
    "intersection": "5200 North Sheridan Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-01-24",
    "latitude": 41.97666,
    "longitude": -87.65504
  },
  {
    "id": "153",
    "intersection": "300 North Hamlin Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-29",
    "latitude": 41.88494,
    "longitude": -87.72081
  },
  {
    "id": "154",
    "intersection": "1000 West Hollywood Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.98561,
    "longitude": -87.65477
  },
  {
    "id": "155",
    "intersection": "4700 West Irving Park Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-20",
    "latitude": 41.95356,
    "longitude": -87.74428
  },
  {
    "id": "156",
    "intersection": "6300 South Damen Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.77903,
    "longitude": -87.67381
  },
  {
    "id": "157",
    "intersection": "2400 West Van Buren Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-28",
    "latitude": 41.87617,
    "longitude": -87.68575
  },
  {
    "id": "158",
    "intersection": "2400 W. Madison",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-05-31",
    "latitude": 41.88125,
    "longitude": -87.68591
  },
  {
    "id": "159",
    "intersection": "800 West Roosevelt Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-12",
    "latitude": 41.86728,
    "longitude": -87.64644
  },
  {
    "id": "160",
    "intersection": "6000 North California Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-27",
    "latitude": 41.99013,
    "longitude": -87.69936
  },
  {
    "id": "161",
    "intersection": "1200 North Ashland Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-23",
    "latitude": 41.90305,
    "longitude": -87.66736
  },
  {
    "id": "162",
    "intersection": "3400 West North Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-04",
    "latitude": 41.91002,
    "longitude": -87.7121
  },
  {
    "id": "163",
    "intersection": "7600 South Stony Island Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.75717,
    "longitude": -87.58617
  },
  {
    "id": "164",
    "intersection": "3200 West 79th St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-09",
    "latitude": 41.74964,
    "longitude": -87.70275
  },
  {
    "id": "165",
    "intersection": "2400 West Lawrence Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-07-30",
    "latitude": 41.96856,
    "longitude": -87.68937
  },
  {
    "id": "166",
    "intersection": "4000 West Irving Park Rd",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-05-18",
    "latitude": 41.95372,
    "longitude": -87.72724
  },
  {
    "id": "167",
    "intersection": "1000 West Hollywood Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-16",
    "latitude": 41.98548,
    "longitude": -87.65564
  },
  {
    "id": "168",
    "intersection": "7432 West Touhy Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-20",
    "latitude": 42.01161,
    "longitude": -87.81185
  },
  {
    "id": "169",
    "intersection": "5500 South Wentworth Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-06",
    "latitude": 41.79383,
    "longitude": -87.63034
  },
  {
    "id": "170",
    "intersection": "3200 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-02-03",
    "latitude": 41.93893,
    "longitude": -87.76666
  },
  {
    "id": "171",
    "intersection": "4000 West Armitage Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.91713,
    "longitude": -87.72678
  },
  {
    "id": "172",
    "intersection": "4000 West 63rd St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-03-30",
    "latitude": 41.7786,
    "longitude": -87.72325
  },
  {
    "id": "173",
    "intersection": "7100 South Cottage Grove Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-29",
    "latitude": 41.76633,
    "longitude": -87.60571
  },
  {
    "id": "174",
    "intersection": "4000 West Roosevelt Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-16",
    "latitude": 41.86627,
    "longitude": -87.72473
  },
  {
    "id": "175",
    "intersection": "5200 N. Nagle",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-12",
    "latitude": 41.97543,
    "longitude": -87.7877
  },
  {
    "id": "176",
    "intersection": "1600 N Pulaski Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-28",
    "latitude": 41.90967,
    "longitude": -87.72636
  },
  {
    "id": "177",
    "intersection": "5400 South Archer Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-12",
    "latitude": 41.79887,
    "longitude": -87.74237
  },
  {
    "id": "178",
    "intersection": "150 North Sacramento Boulevard",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-10-19",
    "latitude": 41.8844,
    "longitude": -87.7014
  },
  {
    "id": "179",
    "intersection": "7900 South Western Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.74973,
    "longitude": -87.6827
  },
  {
    "id": "180",
    "intersection": "7900 South Kedzie Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-08",
    "latitude": 41.75017,
    "longitude": -87.70255
  },
  {
    "id": "181",
    "intersection": "4000 N Austin Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-28",
    "latitude": 41.95277,
    "longitude": -87.77671
  },
  {
    "id": "182",
    "intersection": "�5200 N. Northwest Hwy",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2017-07-09",
    "latitude": 41.97592,
    "longitude": -87.76981
  },
  {
    "id": "183",
    "intersection": "2800 West Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.95387,
    "longitude": -87.69863
  },
  {
    "id": "184",
    "intersection": "1600 W. Madison",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-05",
    "latitude": 41.88156,
    "longitude": -87.6664
  },
  {
    "id": "185",
    "intersection": "200 West Garfield Blvd",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-06",
    "latitude": 41.79446,
    "longitude": -87.63011
  },
  {
    "id": "186",
    "intersection": "6700 South Stony Island Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-24",
    "latitude": 41.77319,
    "longitude": -87.58617
  },
  {
    "id": "187",
    "intersection": "1600 West Division Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-23",
    "latitude": 41.90332,
    "longitude": -87.66781
  },
  {
    "id": "188",
    "intersection": "2400 W. Peterson",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-02-25",
    "latitude": 41.99099,
    "longitude": -87.68974
  },
  {
    "id": "189",
    "intersection": "7100 South Kedzie Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-16",
    "latitude": 41.76468,
    "longitude": -87.7029
  },
  {
    "id": "190",
    "intersection": "2400 North Halsted Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-29",
    "latitude": 41.9251,
    "longitude": -87.64868
  },
  {
    "id": "191",
    "intersection": "7500 South State Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-27",
    "latitude": 41.75788,
    "longitude": -87.62489
  },
  {
    "id": "192",
    "intersection": "7900 South Stony Island Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-06",
    "latitude": 41.75203,
    "longitude": -87.5859
  },
  {
    "id": "193",
    "intersection": "4800 W North Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.9095,
    "longitude": -87.74644
  },
  {
    "id": "194",
    "intersection": "3800 West Madison Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-04-28",
    "latitude": 41.88071,
    "longitude": -87.72117
  },
  {
    "id": "195",
    "intersection": "2800 West Peterson Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-28",
    "latitude": 41.99039,
    "longitude": -87.69978
  },
  {
    "id": "196",
    "intersection": "2000 North Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-12",
    "latitude": 41.91675,
    "longitude": -87.74604
  },
  {
    "id": "197",
    "intersection": "1 South Halsted Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-12",
    "latitude": 41.8815,
    "longitude": -87.64725
  },
  {
    "id": "198",
    "intersection": "6000 N. Western Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-02-24",
    "latitude": 41.99057,
    "longitude": -87.68892
  },
  {
    "id": "199",
    "intersection": "9500 South Halsted Street",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-29",
    "latitude": 41.72211,
    "longitude": -87.64359
  },
  {
    "id": "200",
    "intersection": "6300 South State St",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-16",
    "latitude": 41.78026,
    "longitude": -87.6254
  },
  {
    "id": "201",
    "intersection": "4800 West Fullerton Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-24",
    "latitude": 41.92431,
    "longitude": -87.74588
  },
  {
    "id": "202",
    "intersection": "5600 W Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-29",
    "latitude": 41.95313,
    "longitude": -87.76743
  },
  {
    "id": "203",
    "intersection": "5200 West Madison Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2011-05-10",
    "latitude": 41.8805,
    "longitude": -87.75465
  },
  {
    "id": "204",
    "intersection": "2400 North Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-28",
    "latitude": 41.92524,
    "longitude": -87.6878
  },
  {
    "id": "205",
    "intersection": "1200 West Foster Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.97626,
    "longitude": -87.66029
  },
  {
    "id": "206",
    "intersection": "3600 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-11-13",
    "latitude": 41.94606,
    "longitude": -87.76672
  },
  {
    "id": "207",
    "intersection": "4800 West 47th St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-03-30",
    "latitude": 41.80774,
    "longitude": -87.74265
  },
  {
    "id": "208",
    "intersection": "4000 W North Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.9099,
    "longitude": -87.726
  },
  {
    "id": "209",
    "intersection": "2800 North Kimball Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-27",
    "latitude": 41.93172,
    "longitude": -87.71224
  },
  {
    "id": "210",
    "intersection": "4000 West 79th Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-16",
    "latitude": 41.74961,
    "longitude": -87.72139
  },
  {
    "id": "211",
    "intersection": "6000 W Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-28",
    "latitude": 41.95299,
    "longitude": -87.77715
  },
  {
    "id": "212",
    "intersection": "1600 North Halsted Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-27",
    "latitude": 41.91061,
    "longitude": -87.6482
  },
  {
    "id": "213",
    "intersection": "2800 North California Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-29",
    "latitude": 41.93188,
    "longitude": -87.69745
  },
  {
    "id": "214",
    "intersection": "6000 W Diversey Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-26",
    "latitude": 41.93103,
    "longitude": -87.77638
  },
  {
    "id": "215",
    "intersection": "7900 South State Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-24",
    "latitude": 41.75069,
    "longitude": -87.62512
  },
  {
    "id": "216",
    "intersection": "5600 West Lake Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-16",
    "latitude": 41.88771,
    "longitude": -87.76539
  },
  {
    "id": "217",
    "intersection": "6700 South Cornell Drive",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-25",
    "latitude": 41.77311,
    "longitude": -87.58586
  },
  {
    "id": "218",
    "intersection": "�100 E. Ontario St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-21",
    "latitude": 41.89335,
    "longitude": -87.6237
  },
  {
    "id": "219",
    "intersection": "5500 S Western Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-06",
    "latitude": 41.79419,
    "longitude": -87.68421
  },
  {
    "id": "220",
    "intersection": "7900 South Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-15",
    "latitude": 41.74985,
    "longitude": -87.72204
  },
  {
    "id": "221",
    "intersection": "2000 West Fullerton Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-16",
    "latitude": 41.92494,
    "longitude": -87.67859
  },
  {
    "id": "222",
    "intersection": "6400 North Milwaukee Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-02-26",
    "latitude": 41.99763,
    "longitude": -87.78822
  },
  {
    "id": "223",
    "intersection": "2800 North Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-05-13",
    "latitude": 41.93207,
    "longitude": -87.72703
  },
  {
    "id": "224",
    "intersection": "800 W. DIVISION",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-04-06",
    "latitude": 41.90368,
    "longitude": -87.6477
  },
  {
    "id": "225",
    "intersection": "5200 North Pulaski Rd",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-17",
    "latitude": 41.97583,
    "longitude": -87.72831
  },
  {
    "id": "226",
    "intersection": "4800 North Cicero Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-31",
    "latitude": 41.9676,
    "longitude": -87.74766
  },
  {
    "id": "227",
    "intersection": "3200 West 71st Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-09-16",
    "latitude": 41.76445,
    "longitude": -87.70238
  },
  {
    "id": "228",
    "intersection": "1600 W. 71st",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-10",
    "latitude": 41.76495,
    "longitude": -87.66336
  },
  {
    "id": "229",
    "intersection": "�5232 N. Central Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-24",
    "latitude": 41.97706,
    "longitude": -87.7685
  },
  {
    "id": "230",
    "intersection": "5600 West Chicago Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-05-27",
    "latitude": 41.89479,
    "longitude": -87.76558
  },
  {
    "id": "231",
    "intersection": "6000 W Diversey Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-27",
    "latitude": 41.93119,
    "longitude": -87.77562
  },
  {
    "id": "232",
    "intersection": "3100 South Kedzie Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-21",
    "latitude": 41.83753,
    "longitude": -87.70493
  },
  {
    "id": "233",
    "intersection": "4400 West Grand Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-03-10",
    "latitude": 41.9101,
    "longitude": -87.73653
  },
  {
    "id": "234",
    "intersection": "1600 West 95th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-25",
    "latitude": 41.72109,
    "longitude": -87.66314
  },
  {
    "id": "235",
    "intersection": "2426 North Damen Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-17",
    "latitude": 41.9261,
    "longitude": -87.67801
  },
  {
    "id": "236",
    "intersection": "3400 West Diversey Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-28",
    "latitude": 41.93192,
    "longitude": -87.71264
  },
  {
    "id": "237",
    "intersection": "7432 West Touhy Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-19",
    "latitude": 42.01151,
    "longitude": -87.81262
  },
  {
    "id": "238",
    "intersection": "5200 West Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-01-26",
    "latitude": 41.95322,
    "longitude": -87.75741
  },
  {
    "id": "239",
    "intersection": "4700 S. Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-28",
    "latitude": 41.80873,
    "longitude": -87.68457
  },
  {
    "id": "240",
    "intersection": "300 North Hamlin Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.8855,
    "longitude": -87.72103
  },
  {
    "id": "241",
    "intersection": "�340 W. Upper�Wacker Dr",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-02-18",
    "latitude": 41.88597,
    "longitude": -87.63743
  },
  {
    "id": "242",
    "intersection": "6400 W. Irving Pk",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-12",
    "latitude": 41.95289,
    "longitude": -87.78691
  },
  {
    "id": "243",
    "intersection": "2400 North Cicero Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-02-23",
    "latitude": 41.92458,
    "longitude": -87.74644
  },
  {
    "id": "244",
    "intersection": "4000 West Fullerton Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-05-18",
    "latitude": 41.92461,
    "longitude": -87.72642
  },
  {
    "id": "245",
    "intersection": "3600 North Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.94636,
    "longitude": -87.74715
  },
  {
    "id": "246",
    "intersection": "4000 West Chicago Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-02-19",
    "latitude": 41.89532,
    "longitude": -87.72632
  },
  {
    "id": "247",
    "intersection": "5200 North Western Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-03",
    "latitude": 41.97613,
    "longitude": -87.68922
  },
  {
    "id": "248",
    "intersection": "4800 North Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-01",
    "latitude": 41.96832,
    "longitude": -87.74765
  },
  {
    "id": "249",
    "intersection": "5000 South Archer Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-30",
    "latitude": 41.80269,
    "longitude": -87.72302
  },
  {
    "id": "250",
    "intersection": "2600 South Kedzie Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-10-31",
    "latitude": 41.84408,
    "longitude": -87.70494
  },
  {
    "id": "251",
    "intersection": "2400 West Marquette Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-29",
    "latitude": 41.77203,
    "longitude": -87.68299
  },
  {
    "id": "252",
    "intersection": "1200 N. HALSTED",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-04-05",
    "latitude": 41.90335,
    "longitude": -87.64802
  },
  {
    "id": "253",
    "intersection": "6400 W. Irving Pk",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-13",
    "latitude": 41.95301,
    "longitude": -87.78627
  },
  {
    "id": "254",
    "intersection": "�5616 W. Foster Ave",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2017-07-09",
    "latitude": 41.97561,
    "longitude": -87.76988
  },
  {
    "id": "255",
    "intersection": "9500 South Halsted Street",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-28",
    "latitude": 41.72126,
    "longitude": -87.64299
  },
  {
    "id": "256",
    "intersection": "400 North Central Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-15",
    "latitude": 41.88794,
    "longitude": -87.76513
  },
  {
    "id": "257",
    "intersection": "1200 North Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-07-21",
    "latitude": 41.9029,
    "longitude": -87.72635
  },
  {
    "id": "258",
    "intersection": "2200 South Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-12-27",
    "latitude": 41.85273,
    "longitude": -87.68579
  },
  {
    "id": "259",
    "intersection": "6400 W. Foster",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-13",
    "latitude": 41.9757,
    "longitude": -87.78743
  },
  {
    "id": "260",
    "intersection": "7200 West Belmont Ave",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-17",
    "latitude": 41.93807,
    "longitude": -87.80636
  },
  {
    "id": "261",
    "intersection": "4700 West Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-10-19",
    "latitude": 41.95334,
    "longitude": -87.7451
  },
  {
    "id": "262",
    "intersection": "2800 West Diversey",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-30",
    "latitude": 41.93207,
    "longitude": -87.698
  },
  {
    "id": "263",
    "intersection": "6400 West Devon Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-02-27",
    "latitude": 41.99739,
    "longitude": -87.78737
  },
  {
    "id": "264",
    "intersection": "4700 South Kedzie Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-03-28",
    "latitude": 41.80782,
    "longitude": -87.70386
  },
  {
    "id": "265",
    "intersection": "100 North Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-13",
    "latitude": 41.88148,
    "longitude": -87.74521
  },
  {
    "id": "266",
    "intersection": "�100 E. Jackson Blvd",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-22",
    "latitude": 41.87823,
    "longitude": -87.62485
  },
  {
    "id": "267",
    "intersection": "3500 S. Western",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-09",
    "latitude": 41.83,
    "longitude": -87.6849
  },
  {
    "id": "268",
    "intersection": "3200 West 31st Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-22",
    "latitude": 41.83732,
    "longitude": -87.70445
  },
  {
    "id": "269",
    "intersection": "1600 West Irving Park Road",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.95419,
    "longitude": -87.6695
  },
  {
    "id": "270",
    "intersection": "4000 W. Cermak",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-10-10",
    "latitude": 41.85172,
    "longitude": -87.72434
  },
  {
    "id": "271",
    "intersection": "4400 North Milwaukee Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-03-09",
    "latitude": 41.96043,
    "longitude": -87.75419
  },
  {
    "id": "272",
    "intersection": "5600 West Addison Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-11-14",
    "latitude": 41.94582,
    "longitude": -87.76717
  },
  {
    "id": "273",
    "intersection": "4000 North Ashland Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-24",
    "latitude": 41.95401,
    "longitude": -87.66889
  },
  {
    "id": "274",
    "intersection": "11100 South Halsted St",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2005-12-30",
    "latitude": 41.69259,
    "longitude": -87.64251
  },
  {
    "id": "275",
    "intersection": "800 North Pulaski Road",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2010-02-18",
    "latitude": 41.89562,
    "longitude": -87.7261
  },
  {
    "id": "276",
    "intersection": "4800 West Armitage Avenue",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-11-13",
    "latitude": 41.91687,
    "longitude": -87.74654
  },
  {
    "id": "277",
    "intersection": "6300 South Western Ave",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-11-10",
    "latitude": 41.77893,
    "longitude": -87.68351
  },
  {
    "id": "278",
    "intersection": "4800 W North Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-30",
    "latitude": 41.90972,
    "longitude": -87.74573
  },
  {
    "id": "279",
    "intersection": "800 West 99th St",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2005-12-31",
    "latitude": 41.714,
    "longitude": -87.64329
  },
  {
    "id": "280",
    "intersection": "800 West 119th Street",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2004-11-01",
    "latitude": 41.67786,
    "longitude": -87.64154
  },
  {
    "id": "281",
    "intersection": "0 North Hamlin Boulevard",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-04-28",
    "latitude": 41.8805,
    "longitude": -87.72058
  },
  {
    "id": "282",
    "intersection": "2800 West Irving Park Road",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-24",
    "latitude": 41.95409,
    "longitude": -87.69779
  },
  {
    "id": "283",
    "intersection": "1 East 63rd St",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2006-01-17",
    "latitude": 41.78008,
    "longitude": -87.62507
  },
  {
    "id": "284",
    "intersection": "7900 South Halsted Street",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-04-28",
    "latitude": 41.75044,
    "longitude": -87.64395
  },
  {
    "id": "285",
    "intersection": "400 East 31st Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-21",
    "latitude": 41.83835,
    "longitude": -87.61806
  },
  {
    "id": "286",
    "intersection": "5200 W Fullerton Avenue",
    "firstApproach": "WB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-27",
    "latitude": 41.92421,
    "longitude": -87.75571
  },
  {
    "id": "287",
    "intersection": "4800 North Ashland Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-08-25",
    "latitude": 41.96914,
    "longitude": -87.66957
  },
  {
    "id": "288",
    "intersection": "2400 W 55th Street",
    "firstApproach": "EB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-07",
    "latitude": 41.79378,
    "longitude": -87.68451
  },
  {
    "id": "289",
    "intersection": "3600 N Austin Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-26",
    "latitude": 41.94599,
    "longitude": -87.77642
  },
  {
    "id": "290",
    "intersection": "4000 North Elston Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-08-10",
    "latitude": 41.95405,
    "longitude": -87.71979
  },
  {
    "id": "291",
    "intersection": "8700 South Ashland Ave",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-03-29",
    "latitude": 41.73609,
    "longitude": -87.66307
  },
  {
    "id": "292",
    "intersection": "9500 South Ashland Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-06-24",
    "latitude": 41.72157,
    "longitude": -87.66285
  },
  {
    "id": "293",
    "intersection": "800 North Cicero Avenue",
    "firstApproach": "NB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-10-03",
    "latitude": 41.89484,
    "longitude": -87.74573
  },
  {
    "id": "294",
    "intersection": "2400 North Clark St",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2007-06-26",
    "latitude": 41.92575,
    "longitude": -87.64063
  },
  {
    "id": "295",
    "intersection": "2800 N Damen Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-06-28",
    "latitude": 41.93248,
    "longitude": -87.67814
  },
  {
    "id": "296",
    "intersection": "�5232 N. Milwaukee Ave",
    "firstApproach": "SEB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2018-01-24",
    "latitude": 41.97672,
    "longitude": -87.76878
  },
  {
    "id": "297",
    "intersection": "400 South Western Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2008-05-27",
    "latitude": 41.87651,
    "longitude": -87.68647
  },
  {
    "id": "298",
    "intersection": "4200 South Cicero Avenue",
    "firstApproach": "SB",
    "secondApproach": null,
    "thirdApproach": null,
    "goLiveDate": "2009-04-28",
    "latitude": 41.81737,
    "longitude": -87.7436
  }
];
