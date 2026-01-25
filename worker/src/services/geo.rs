//! Geographic calculations

use crate::types::Coordinates;

/// Earth radius in kilometers
const EARTH_RADIUS_KM: f64 = 6371.0;

/// Road distance coefficient (straight line to road)
const ROAD_COEFFICIENT: f64 = 1.3;

/// Average speed in km/h for travel time estimation
const AVERAGE_SPEED_KMH: f64 = 40.0;

/// Calculate Haversine distance between two points in kilometers
pub fn haversine_distance(from: &Coordinates, to: &Coordinates) -> f64 {
    let d_lat = (to.lat - from.lat).to_radians();
    let d_lon = (to.lng - from.lng).to_radians();

    let lat1 = from.lat.to_radians();
    let lat2 = to.lat.to_radians();

    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);

    let c = 2.0 * a.sqrt().asin();

    EARTH_RADIUS_KM * c
}

/// Estimate road distance from straight-line distance
pub fn road_distance(from: &Coordinates, to: &Coordinates) -> f64 {
    haversine_distance(from, to) * ROAD_COEFFICIENT
}

/// Estimate travel time in minutes
pub fn travel_time_minutes(from: &Coordinates, to: &Coordinates) -> f64 {
    let distance = road_distance(from, to);
    (distance / AVERAGE_SPEED_KMH) * 60.0
}

/// Calculate distance matrix between all points
/// Returns a 2D vector where matrix[i][j] is distance from point i to point j
pub fn distance_matrix(points: &[Coordinates]) -> Vec<Vec<f64>> {
    let n = points.len();
    let mut matrix = vec![vec![0.0; n]; n];

    for i in 0..n {
        for j in 0..n {
            if i != j {
                matrix[i][j] = road_distance(&points[i], &points[j]);
            }
        }
    }

    matrix
}

/// Calculate time matrix between all points (in minutes)
pub fn time_matrix(points: &[Coordinates]) -> Vec<Vec<f64>> {
    let n = points.len();
    let mut matrix = vec![vec![0.0; n]; n];

    for i in 0..n {
        for j in 0..n {
            if i != j {
                matrix[i][j] = travel_time_minutes(&points[i], &points[j]);
            }
        }
    }

    matrix
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_haversine_prague_brno() {
        let prague = Coordinates { lat: 50.0755, lng: 14.4378 };
        let brno = Coordinates { lat: 49.1951, lng: 16.6068 };

        let distance = haversine_distance(&prague, &brno);

        // Prague to Brno is approximately 185 km
        assert!((distance - 185.0).abs() < 5.0);
    }

    #[test]
    fn test_haversine_same_point() {
        let point = Coordinates { lat: 50.0, lng: 14.0 };
        let distance = haversine_distance(&point, &point);
        assert!((distance - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_road_distance() {
        let prague = Coordinates { lat: 50.0755, lng: 14.4378 };
        let brno = Coordinates { lat: 49.1951, lng: 16.6068 };

        let distance = road_distance(&prague, &brno);
        let straight = haversine_distance(&prague, &brno);

        // Road distance should be ~30% more than straight line
        assert!((distance / straight - ROAD_COEFFICIENT).abs() < 0.01);
    }

    #[test]
    fn test_travel_time() {
        let from = Coordinates { lat: 50.0, lng: 14.0 };
        let to = Coordinates { lat: 50.0, lng: 14.5 };

        let time = travel_time_minutes(&from, &to);

        // Should be positive and reasonable
        assert!(time > 0.0);
        assert!(time < 120.0); // Less than 2 hours for ~40km
    }

    #[test]
    fn test_distance_matrix() {
        let points = vec![
            Coordinates { lat: 50.0, lng: 14.0 },
            Coordinates { lat: 50.1, lng: 14.1 },
            Coordinates { lat: 50.2, lng: 14.2 },
        ];

        let matrix = distance_matrix(&points);

        assert_eq!(matrix.len(), 3);
        assert_eq!(matrix[0].len(), 3);

        // Diagonal should be zero
        assert!((matrix[0][0] - 0.0).abs() < 0.001);
        assert!((matrix[1][1] - 0.0).abs() < 0.001);
        assert!((matrix[2][2] - 0.0).abs() < 0.001);

        // Should be symmetric
        assert!((matrix[0][1] - matrix[1][0]).abs() < 0.001);
    }
}
