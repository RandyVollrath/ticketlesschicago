# ⚠️ DO NOT MODIFY THIS FILE ⚠️

## components/StreetCleaningMap.tsx

**THIS FILE IS LOCKED - DO NOT EDIT**

This map component is working correctly as of commit 394c8a3f.

### What broke it:
- Changing the useEffect dependency array
- Trying to optimize layer re-rendering
- Separating map initialization from data updates

### Why it works now:
- The map re-initializes on every data change (intentional)
- Leaflet handles coordinate transformations automatically
- All layers are properly cleared and re-added each render

### If you need to modify:
1. Create a backup first: `git show 394c8a3f:components/StreetCleaningMap.tsx > backup.tsx`
2. Test extensively on check-your-street page
3. Test zoom in/out behavior
4. Test zone highlighting
5. If it breaks, revert immediately: `git checkout 394c8a3f -- components/StreetCleaningMap.tsx`

**Last working commit:** 394c8a3f (Revert map to working version before my changes)
