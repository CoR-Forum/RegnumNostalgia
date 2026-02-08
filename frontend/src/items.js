/**
 * Item display utility functions.
 */

/** Returns a human-friendly label for an item's type and equipment slot. */
export function getItemTypeLabel(item) {
  const slot = item.equipmentSlot || null;
  if (slot) {
    switch (slot) {
      case 'head': return 'Armor (Head)';
      case 'body': return 'Armor (Body)';
      case 'hands': return 'Armor (Hands)';
      case 'shoulders': return 'Armor (Shoulders)';
      case 'legs': return 'Armor (Legs)';
      case 'weaponRight': return 'Weapon (Right Hand)';
      case 'weaponLeft': return 'Weapon (Left Hand)';
      case 'ringRight':
      case 'ringLeft': return 'Ring';
      case 'amulet': return 'Amulet';
      default: return item.itemType || '';
    }
  }
  const t = item.itemType || '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Normalize item display name across different API shapes. */
export function getItemName(item) {
  if (!item) return 'Unknown Item';
  return item.itemName || item.name || item.displayName || 'Unknown Item';
}
