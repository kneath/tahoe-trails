import * as THREE from 'three';

// The palette is authored directly in display (sRGB) values, so skip three's
// linear-space conversions. This must run before any THREE.Color is created.
THREE.ColorManagement.enabled = false;
