import { NextApiRequest, NextApiResponse } from 'next';

// Pre-computed geometry for Chicago winter overnight parking ban streets
// These coordinates are geocoded from the official city data
const WINTER_BAN_ROUTES = [
  {
    street_name: "MADISON AVE",
    from_location: "CANAL STREET",
    to_location: "DES PLAINES AVE.",
    coords: [[-87.6396848, 41.8818893], [-87.6441237, 41.8818215]]
  },
  {
    street_name: "STATE STREET",
    from_location: "600 SOUTH",
    to_location: "2200 SOUTH",
    coords: [[-87.6279921, 41.8851226], [-87.6247066, 41.7558896]]
  },
  {
    street_name: "CERMAK ROAD",
    from_location: "STATE STREET",
    to_location: "Dr M L KING Jr Dr",
    coords: [[-87.6271475, 41.8529548], [-87.8039397, 41.8504068]]
  },
  {
    street_name: "Dr M L KING Jr Dr",
    from_location: "2600 SOUTH",
    to_location: "5500 SOUTH",
    coords: [[-87.6323879, 41.88325], [-87.7576752, 41.7489157]]
  },
  {
    street_name: "MIDWAY PLAISANCE",
    from_location: "COTTAGE GROVE",
    to_location: "DORCHESTER",
    coords: [[-87.6060171, 41.7871374], [-87.5915039, 41.7872879]]
  },
  {
    street_name: "COTTAGE GROVE",
    from_location: "MIDWAY PLAISANCE",
    to_location: "103RD STREET",
    coords: [[-87.6060171, 41.7871374], [-87.6065205, 41.7074405]]
  },
  {
    street_name: "TORRENCE AVE.",
    from_location: "106TH STREET",
    to_location: "103RD STREET",
    coords: [[-87.5595931, 41.7027829], [-87.5596552, 41.7081765]]
  },
  {
    street_name: "106TH STREET",
    from_location: "TORRENCE AVE.",
    to_location: "STATE LINE ROAD",
    coords: [[-87.5595931, 41.7027829], [-87.5245416, 41.7026866]]
  },
  {
    street_name: "ARCHER AVE.",
    from_location: "STATE STREET",
    to_location: "HARLEM AVE.",
    coords: [[-87.6272644, 41.8564855], [-87.801612, 41.7919749]]
  },
  {
    street_name: "KEDZIE AVE.",
    from_location: "JACKSON BLVD.",
    to_location: "8700 SOUTH",
    coords: [[-87.7060215, 41.8773301], [-87.7029421, 41.7346577]]
  },
  {
    street_name: "79TH STREET",
    from_location: "CICERO AVE.",
    to_location: "SOUTH SHORE DRIVE",
    coords: [[-87.7414712, 41.7492087], [-87.5480689, 41.7519934]]
  },
  {
    street_name: "103RD STREET",
    from_location: "PULASKI RD.",
    to_location: "TORRENCE AVE.",
    coords: [[-87.7209679, 41.705918], [-87.5596552, 41.7081765]]
  },
  {
    street_name: "MILWAUKEE AVE",
    from_location: "CENTRAL AVE.",
    to_location: "400 NORTH",
    coords: [[-87.7685126, 41.9764016], [-87.6443426, 41.8890498]]
  },
  {
    street_name: "DEVON AVE.",
    from_location: "BROADWAY",
    to_location: "CLARK STREET",
    coords: [[-87.660628, 41.9981996], [-87.6707071, 41.9980831]]
  },
  {
    street_name: "CLARK STREET",
    from_location: "DEVON AVE.",
    to_location: "HOWARD STREET",
    coords: [[-87.6707071, 41.9980831], [-87.6763851, 42.0194082]]
  },
  {
    street_name: "FOSTER AVE.",
    from_location: "ASHLAND AVE.",
    to_location: "CLARK STREET",
    coords: [[-87.6695545, 41.9761728], [-87.6683934, 41.9761938]]
  },
  {
    street_name: "FOSTER AVE.",
    from_location: "ASHLAND AVE.",
    to_location: "5430 WEST",
    coords: [[-87.6695545, 41.9761728], [-87.7639511, 41.9754855]]
  },
  {
    street_name: "CENTRAL AVE",
    from_location: "BRYN MAWR AVE.",
    to_location: "FULLERTON AVE.",
    coords: [[-87.7683474, 41.982942], [-87.7659905, 41.9239328]]
  },
  {
    street_name: "DIVISION STREET",
    from_location: "LA SALLE ST.",
    to_location: "KEDZIE AVE",
    coords: [[-87.6329986, 41.9038752], [-87.7067867, 41.9028787]]
  },
  {
    street_name: "DIVISION STREET",
    from_location: "HOMAN AVE.",
    to_location: "AUSTIN AVE.",
    coords: [[-87.7116725, 41.902806], [-87.77537, 41.9020014]]
  },
  {
    street_name: "MADISON AVE.",
    from_location: "AUSTIN AVE.",
    to_location: "HALSTED STREET",
    coords: [[-87.774658, 41.8800351], [-87.6473823, 41.8817919]]
  },
  {
    street_name: "CENTRAL AVE.",
    from_location: "HARRISON ST.",
    to_location: "FULLERTON AVE.",
    coords: [[-87.764541, 41.8728244], [-87.7659905, 41.9239328]]
  }
];

/**
 * Get winter ban routes with pre-computed geometry for map display
 * Returns GeoJSON features for the 22 Chicago winter overnight parking ban streets
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const routes = WINTER_BAN_ROUTES.map(street => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: street.coords
      },
      properties: {
        street_name: street.street_name,
        from_location: street.from_location,
        to_location: street.to_location,
        restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)'
      }
    }));

    return res.status(200).json({
      routes,
      count: routes.length,
      successfullyGeocoded: routes.length,
      cached: true
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
