# Permit Zone Report UI Research

## Executive Summary
Research completed on permit zone result display in Ticketless Chicago mobile app. Found:
1. **Existing API endpoint** for zone hour reporting (auto-accept with photo upload)
2. **Permit zone display** in HomeScreen hero card with zone name + summary
3. **Bottom sheet modal pattern** already used in app (for protection info)
4. **RuleCard component** renders individual parking rules
5. **No existing report UI** — opportunity to add permit zone-specific reporting

---

## 1. Permit Zone Result Display

### File: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

#### Data Flow
- **Lines 227**: Home permit zone state
- **Lines 359-361**: Load permit zone from AsyncStorage
- **Lines 962-985**: `permitZoneSummary` computed logic

#### Permit Zone Summary Rendering
```jsx
// Lines 963-985
const permitZoneSummary = (() => {
  if (heroState !== 'clear' || !lastParkingCheck) return null;
  
  const parkedZoneRaw = String(
    lastParkingCheck.rawApiData?.permitZone?.zoneName ||
    lastParkingCheck.rawApiData?.permitZone?.zone ||
    ''
  ).trim();
  
  if (!parkedZoneRaw) {
    return homePermitZone ? 'Not in a designated permit zone.' : null;
  }
  
  const normalize = (value: string) => 
    value.toLowerCase().replace(/^zone\s*/i, '').trim();
  const parkedNorm = normalize(parkedZoneRaw);
  const homeNorm = homePermitZone ? normalize(homePermitZone) : '';
  
  if (!homePermitZone) {
    return `In permit zone ${parkedZoneRaw}. Set your home zone in Settings.`;
  }
  
  return parkedNorm === homeNorm
    ? `In your designated permit zone (Zone ${homePermitZone}).`
    : `Not in your designated zone. You are in Zone ${parkedZoneRaw}.`;
})();
```

#### Hero Card Permit Summary Display
```jsx
// Lines 1444-1449 (inside expanded hero card details)
{!!permitZoneSummary && (
  <View style={styles.heroPermitSummaryRow}>
    <MaterialCommunityIcons 
      name="card-account-details-outline" 
      size={14} 
      color="rgba(255,255,255,0.9)" 
    />
    <Text style={styles.heroPermitSummaryText}>
      {permitZoneSummary}
    </Text>
  </View>
)}
```

#### Styles for Permit Summary
```javascript
// Lines 2320-2325
heroPermitSummaryRow: {
  // (flexDirection, gap, margin styles)
},
heroPermitSummaryText: {
  // (fontSize, color, lineHeight styles)
},
```

---

## 2. Rule Card Component

### File: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/RuleCard.tsx`

Full component that renders individual parking rules. Key features:

#### Rule Type Icons & Labels
```typescript
// Lines 11-47
const getRuleIcon = (type: ParkingRule['type']): string => {
  switch (type) {
    case 'permit_zone': return 'parking';  // LINE 18
    // ... other types
  }
};

const getRuleLabel = (type: ParkingRule['type']): string => {
  switch (type) {
    case 'permit_zone': return 'Permit Zone';  // LINE 37
    // ... other types
  }
};
```

#### Permit Zone in RuleCard
```jsx
// Lines 73-129 (Full RuleCard component)
const RuleCard: React.FC<RuleCardProps> = ({ rule }) => {
  const severityStyle = getSeverityStyle(rule.severity);
  
  return (
    <View style={[
      styles.container,
      { backgroundColor: severityStyle.backgroundColor }
    ]}>
      <View style={styles.header}>
        <MaterialCommunityIcons
          name={getRuleIcon(rule.type)}
          size={18}
          color={severityStyle.textColor}
        />
        <View style={styles.headerText}>
          <Text style={[styles.label, { color: severityStyle.textColor }]}>
            {getRuleLabel(rule.type)}
            {rule.zoneName ? ` - ${rule.zoneName}` : ''}  {/* LINE 96 */}
          </Text>
          {rule.isActiveNow && (
            <View style={[styles.activeBadge, /* ... */]}>
              <Text style={styles.activeBadgeText}>ACTIVE NOW</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.message}>{rule.message}</Text>
      {rule.schedule && (
        <View style={styles.scheduleRow}>
          {/* Schedule display */}
        </View>
      )}
    </View>
  );
};
```

**Note**: Zone name is displayed in the rule label (line 96)

---

## 3. Bottom Sheet Modal Pattern

### File: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

This is the **exact pattern to reuse** for the permit zone report form.

#### State Definition
```typescript
// Line 232-233
const [activeSheet, setActiveSheet] = useState<ProtectionItem | null>(null);
```

#### ProtectionItem Interface
```typescript
// Lines 140-146
interface ProtectionItem {
  icon: string;
  label: string;
  sheetTitle: string;
  sheetBody: string;
  sheetAction?: { label: string; target: 'manage' | 'settings'; scrollTo?: string };
}
```

#### Example Protection Items
```typescript
// Lines 148-181 — Permit Zone Protection Item
{
  icon: 'parking',
  label: 'Residential Permits',
  sheetTitle: 'Residential Permit Zones',
  sheetBody: 'We check if your parking spot requires a residential permit. Add your home zone number so we know which zones are safe for you.',
  sheetAction: { label: 'Add My Permit Zone', target: 'settings', scrollTo: 'permit_zone' },
}
```

#### Modal Trigger
```jsx
// Lines 1877-1882 (Protection row tap)
<TouchableOpacity
  key={index}
  style={styles.protectionRow}
  onPress={() => setActiveSheet(item)}  {/* Trigger modal */}
  activeOpacity={0.7}
>
  {/* ... render protection item ... */}
</TouchableOpacity>
```

#### Modal Implementation
```jsx
// Lines 1926-1977
<Modal
  visible={activeSheet !== null}
  transparent
  animationType="slide"
  onRequestClose={() => setActiveSheet(null)}
>
  <TouchableOpacity
    style={styles.sheetOverlay}
    activeOpacity={1}
    onPress={() => setActiveSheet(null)}  {/* Tap outside closes */}
  >
    <View style={styles.sheetContainer} onStartShouldSetResponder={() => true}>
      <View style={styles.sheetHandle} />
      {activeSheet && (
        <>
          <View style={styles.sheetHeader}>
            <MaterialCommunityIcons
              name={activeSheet.icon}
              size={28}
              color={colors.primary}
            />
            <Text style={styles.sheetTitle}>
              {activeSheet.sheetTitle}
            </Text>
          </View>
          <Text style={styles.sheetBody}>
            {activeSheet.sheetBody}
          </Text>
          {activeSheet.sheetAction && (
            <TouchableOpacity
              style={styles.sheetActionButton}
              onPress={() => {
                const action = activeSheet.sheetAction!;
                setActiveSheet(null);
                if (action.target === 'manage') {
                  navigation.navigate('Manage');
                } else {
                  navigation.navigate('Settings', 
                    { scrollTo: action.scrollTo }
                  );
                }
              }}
            >
              <Text style={styles.sheetActionText}>
                {activeSheet.sheetAction.label}
              </Text>
              <MaterialCommunityIcons 
                name="chevron-right" 
                size={18} 
                color={colors.primary} 
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.sheetDismiss}
            onPress={() => setActiveSheet(null)}
          >
            <Text style={styles.sheetDismissText}>Got it</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  </TouchableOpacity>
</Modal>
```

#### Bottom Sheet Styles
```javascript
// Lines 2690-2751
sheetOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.6)',  // Dark overlay
  justifyContent: 'flex-end',
},
sheetContainer: {
  backgroundColor: colors.cardBg,  // Dark card color
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  padding: spacing.lg,
  paddingBottom: spacing.xxl,
},
sheetHandle: {
  width: 36,
  height: 4,
  borderRadius: 2,
  backgroundColor: colors.border,  // Gray drag handle
  alignSelf: 'center',
  marginBottom: spacing.lg,
},
sheetHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  marginBottom: spacing.md,
},
sheetTitle: {
  fontSize: typography.sizes.lg,
  fontWeight: typography.weights.bold,
  color: colors.textPrimary,
},
sheetBody: {
  fontSize: typography.sizes.md,
  color: colors.textSecondary,
  lineHeight: typography.sizes.md * typography.lineHeights.relaxed,
  marginBottom: spacing.lg,
},
sheetActionButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.primaryTint,  // Light blue
  paddingVertical: 12,
  paddingHorizontal: spacing.lg,
  borderRadius: borderRadius.lg,
  gap: 6,
  marginBottom: spacing.md,
},
sheetActionText: {
  fontSize: typography.sizes.md,
  fontWeight: typography.weights.semibold,
  color: colors.primary,  // Blue text
},
sheetDismiss: {
  alignItems: 'center',
  paddingVertical: spacing.sm,
},
sheetDismissText: {
  fontSize: typography.sizes.md,
  color: colors.textTertiary,  // Gray text
  fontWeight: typography.weights.medium,
},
```

---

## 4. Existing Report/Feedback Patterns

### File: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

#### Ground Truth Feedback Banner
```jsx
// Lines 1200-1228 (Shows after parking detection)
{showGroundTruthBanner && lastParkingCheck && !isDriving && (
  <View style={styles.groundTruthBanner}>
    <View style={styles.groundTruthBannerHeader}>
      <MaterialCommunityIcons 
        name="map-marker-check-outline" 
        size={18} 
        color={colors.primary} 
      />
      <Text style={styles.groundTruthBannerTitle}>
        Parking detected. Is this correct?
      </Text>
    </View>
    <Text style={styles.groundTruthBannerBody} numberOfLines={2}>
      {lastParkingCheck.address}
    </Text>
    <View style={styles.groundTruthBannerActions}>
      <TouchableOpacity
        style={styles.groundTruthNegativeBtn}
        onPress={markFalsePositiveParking}
      >
        <Text style={styles.groundTruthNegativeText}>False alarm</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.groundTruthPositiveBtn}
        onPress={confirmParkingHere}
      >
        <Text style={styles.groundTruthPositiveText}>Parked correctly</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

#### Feedback Buttons in Expanded Hero Card
```jsx
// Lines 1524-1543 (Permit zone correction opportunity here)
<View style={styles.heroFeedbackRow}>
  <TouchableOpacity
    style={styles.heroFeedbackButton}
    onPress={markFalsePositiveParking}
  >
    <MaterialCommunityIcons 
      name="close-circle-outline" 
      size={14} 
      color={colors.white} 
    />
    <Text style={styles.heroFeedbackText}>Not parked</Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={styles.heroFeedbackButton}
    onPress={confirmParkingHere}
  >
    <MaterialCommunityIcons 
      name="check-circle-outline" 
      size={14} 
      color={colors.white} 
    />
    <Text style={styles.heroFeedbackText}>I parked here</Text>
  </TouchableOpacity>
</View>
```

---

## 5. Backend API Endpoint for Zone Reporting

### File: `/home/randy-vollrath/ticketless-chicago/pages/api/mobile/report-zone-hours.ts`

**This endpoint already exists and is ready to use!**

#### Endpoint Behavior
- **URL**: `POST /api/mobile/report-zone-hours`
- **Auth**: Optional (Bearer token supported)
- **Request Body**:
```typescript
{
  zone: string;              // Zone number
  zoneType?: 'residential' | 'industrial';  // Defaults to 'residential'
  schedule: string;          // User-reported schedule (required)
  currentSchedule?: string;  // What app showed (for audit)
  latitude?: number;         // GPS lat
  longitude?: number;        // GPS lng
  address?: string;          // Reverse-geocoded address
  rawSignText?: string;      // User typed the sign text
  photoBase64?: string;      // Base64-encoded JPEG (max 10MB)
}
```

#### Features
1. **Auto-Accept**: Immediately creates block-level override
2. **Photo Upload**: Stores in Supabase storage bucket `zone-sign-photos`
3. **Address Parsing**: Uses `parseChicagoAddress()` to extract block info
4. **Reverse Geocoding**: Falls back to OpenStreetMap nominatim if address parsing fails
5. **Audit Trail**: Saves report to `permit_zone_user_reports` table
6. **Block Override**: Upserts `permit_zone_block_overrides` with source=`user_report`

#### Response Examples
**Success (applied immediately)**:
```json
{
  "success": true,
  "applied": true,
  "message": "Thanks! Your correction has been applied immediately.",
  "override": {
    "zone": "A",
    "block": "3000 N Lincoln",
    "schedule": "Mon-Fri 8am-10pm"
  }
}
```

**Success (saved but not applied)**:
```json
{
  "success": true,
  "applied": false,
  "message": "Report saved. We could not determine the exact block — a team member will review it."
}
```

---

## 6. LocationService Data Flow

### File: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

#### ParkingCheckResult Interface
```typescript
// Lines 77-84
export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
  /** Raw API response data — used by BackgroundTaskService for scheduling */
  rawApiData?: any;  // Contains permitZone object
}
```

#### ParkingRule Interface
```typescript
// Lines 14-32
export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | ...;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  schedule?: string;
  zoneName?: string;          // ← Zone name stored here
  nextDate?: string;
  isActiveNow?: boolean;
  // ... other fields
}
```

#### Permit Zone Parsing
```typescript
// Lines 915-927 (checkParkingLocation method)
// Permit zones - show if in zone (even if not currently restricted)
if (data?.permitZone?.inPermitZone) {
  const severity = data.permitZone.permitRequired ? 'warning' :
                   (data.permitZone.severity || 'info');
  rules.push({
    type: 'permit_zone',
    message: data.permitZone.message,
    severity: severity as 'critical' | 'warning' | 'info',
    zoneName: data.permitZone.zoneName,  // ← Extracted here
    schedule: data.permitZone.restrictionSchedule,
    isActiveNow: data.permitZone.permitRequired,
  });
}
```

---

## 7. Web App Permit Zone Display Reference

### File: `/home/randy-vollrath/ticketless-chicago/pages/check-your-street.tsx`

Shows how permit zones are displayed on the web (for reference):

```jsx
// Lines 530-570
{permitZoneResult?.hasPermitZone && permitZoneResult.zones.length > 0 && (
  <Alert
    variant="warning"
    title={`Residential Permit Parking Zone${
      permitZoneResult.zones.length > 1 ? 's' : ''
    }`}
    description={`This address is in permit parking zone${
      permitZoneResult.zones.length > 1 ? 's' : ''
    } ${permitZoneResult.zones
      .map((z: any) => z.zone || z.zone_number)
      .join(', ')}`}
    icon={<Parking className="h-5 w-5" />}
  />
)}
```

---

## Key Findings Summary

| Item | File | Location | Notes |
|------|------|----------|-------|
| **Permit Zone State** | HomeScreen.tsx | Line 227 | `homePermitZone` from AsyncStorage |
| **Zone Summary Logic** | HomeScreen.tsx | Lines 963-985 | Compares parked zone vs home zone |
| **Hero Card Display** | HomeScreen.tsx | Lines 1444-1449 | Shows in expanded details |
| **RuleCard Component** | RuleCard.tsx | Lines 73-129 | Renders rule with zone name (line 96) |
| **Bottom Sheet Pattern** | HomeScreen.tsx | Lines 1926-1977 | Use for report form modal |
| **Sheet Styles** | HomeScreen.tsx | Lines 2690-2751 | Dark theme, overlay, handle |
| **Existing Report API** | report-zone-hours.ts | Full file | Auto-accept + photo upload |
| **Data Flow** | LocationService.ts | Lines 915-927 | Zone name in `rule.zoneName` |
| **Feedback Buttons** | HomeScreen.tsx | Lines 1524-1543 | Pattern for "Report" button |

---

## Opportunity: Permit Zone Report Button

**Suggested Implementation**:
1. Add "Report" button next to existing permit zone summary in hero card (or in feedback row)
2. Tap opens bottom sheet modal (reuse existing pattern)
3. Modal shows:
   - Current schedule we're displaying
   - Input field for "what sign says"
   - Photo capture button (reuse camera module)
   - Submit button to call `/api/mobile/report-zone-hours`
4. API auto-accepts and updates the block override immediately
5. Show success message in sheet

**Icon suggestion**: `alert-circle` or `exclamation-thick` (warn color)

