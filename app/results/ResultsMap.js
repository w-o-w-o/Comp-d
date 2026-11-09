"use client";

import { useEffect, useState } from "react";
import { AdvancedMarker, Circle, Map, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MAPS_KEY, SEARCH_RADIUS_METERS } from "../maps/config";

// Google Map centered on the searched property, with the comparison area drawn
// around it. Uses the exact place when one was picked from the suggestions,
// otherwise looks up the typed address.
export default function ResultsMap({ address, placeId }) {
  const places = useMapsLibrary("places");
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    if (!places) return;
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const fields = ["formattedAddress", "location"];
        let place;
        if (placeId) {
          place = new places.Place({ id: placeId });
          await place.fetchFields({ fields });
        } else {
          const { places: found } = await places.Place.searchByText({
            textQuery: address,
            fields,
            maxResultCount: 1,
          });
          place = found[0];
        }
        if (!place?.location) throw new Error("Address not found");
        if (!cancelled) {
          setState({
            status: "ready",
            position: place.location.toJSON(),
            formattedAddress: place.formattedAddress,
          });
        }
      } catch (err) {
        console.error("Map lookup failed:", err);
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [places, address, placeId]);

  if (!MAPS_KEY) {
    return (
      <div className="card placeholder map-card">
        <h3>Map &amp; search area</h3>
        <p>Add a Google Maps API key to show the property on a map.</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="card map-card map-message">
        <h3>We couldn&apos;t find that address on the map</h3>
        <p>Try searching again and picking an address from the suggestions.</p>
      </div>
    );
  }

  if (state.status !== "ready") {
    return <div className="card map-card map-loading" aria-label="Loading map" />;
  }

  return (
    <div className="map-wrap">
      <div className="card map-card map-live">
        <Map
          key={`${state.position.lat},${state.position.lng}`}
          mapId="DEMO_MAP_ID"
          defaultCenter={state.position}
          defaultZoom={13}
          gestureHandling="cooperative"
          colorScheme="FOLLOW_SYSTEM"
          style={{ width: "100%", height: "100%" }}
        >
          <AdvancedMarker position={state.position} title={state.formattedAddress} />
          <Circle
            center={state.position}
            radius={SEARCH_RADIUS_METERS}
            strokeColor="#2fa77a"
            strokeOpacity={0.9}
            strokeWeight={2}
            fillColor="#2fa77a"
            fillOpacity={0.12}
            clickable={false}
          />
        </Map>
      </div>
      <p className="map-caption">
        {state.formattedAddress} · Shaded area: 1-mile comparison radius
      </p>
    </div>
  );
}
