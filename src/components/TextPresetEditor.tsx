import { useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextLayer, TextPreset } from '../settings';

type Props = {
  visible: boolean;
  initial: TextPreset;
  onCancel: () => void;
  onSave: (preset: TextPreset) => void;
};

const COLORS = ['#ffffff', '#f5f5f5', '#ffd60a', '#ff453a', '#64d2ff', '#30d158'];

export default function TextPresetEditor({ visible, initial, onCancel, onSave }: Props) {
  const [preset, setPreset] = useState<TextPreset>(initial);
  const [selectedId, setSelectedId] = useState(initial.layers[0]?.id ?? '');
  const selected = useMemo(
    () => preset.layers.find((layer) => layer.id === selectedId) ?? preset.layers[0],
    [preset.layers, selectedId],
  );
  const stage = Dimensions.get('window');

  function updateLayer(patch: Partial<TextLayer>) {
    if (!selected) {
      return;
    }
    setPreset((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === selected.id ? { ...layer, ...patch } : layer,
      ),
    }));
  }

  function addLayer() {
    const layer: TextLayer = {
      id: `layer-${Date.now()}`,
      text: 'New text',
      x: 0.5,
      y: 0.55,
      size: 28,
      color: '#ffffff',
    };
    setPreset((current) => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedId(layer.id);
  }

  function removeLayer() {
    if (!selected || preset.layers.length <= 1) {
      return;
    }
    const next = preset.layers.filter((layer) => layer.id !== selected.id);
    setPreset((current) => ({ ...current, layers: next }));
    setSelectedId(next[0].id);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onCancel}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Text cover</Text>
          <Pressable onPress={() => onSave(preset)}>
            <Text style={styles.headerAction}>Save</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.nameInput}
          value={preset.name}
          onChangeText={(name) => setPreset((current) => ({ ...current, name }))}
          placeholder="Preset name"
          placeholderTextColor="#71717a"
        />

        <View
          style={[styles.stage, { backgroundColor: preset.background, height: stage.height * 0.48 }]}
        >
          {preset.layers.map((layer) => (
            <Pressable
              key={layer.id}
              onPress={() => setSelectedId(layer.id)}
              style={[
                styles.layer,
                {
                  left: layer.x * stage.width - 80,
                  top: layer.y * (stage.height * 0.48) - 20,
                  borderColor: layer.id === selected?.id ? '#60a5fa' : 'transparent',
                },
              ]}
            >
              <Text style={{ color: layer.color, fontSize: layer.size, fontWeight: '700' }}>
                {layer.text || ' '}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.hint}>Tap a text, then edit below. Drag with the arrows.</Text>

        {selected ? (
          <View style={styles.tools}>
            <TextInput
              style={styles.textInput}
              value={selected.text}
              onChangeText={(text) => updateLayer({ text })}
              placeholder="Type what people should see"
              placeholderTextColor="#71717a"
            />
            <View style={styles.row}>
              <ToolButton label="←" onPress={() => updateLayer({ x: Math.max(0.08, selected.x - 0.04) })} />
              <ToolButton label="→" onPress={() => updateLayer({ x: Math.min(0.92, selected.x + 0.04) })} />
              <ToolButton label="↑" onPress={() => updateLayer({ y: Math.max(0.08, selected.y - 0.04) })} />
              <ToolButton label="↓" onPress={() => updateLayer({ y: Math.min(0.92, selected.y + 0.04) })} />
              <ToolButton label="A-" onPress={() => updateLayer({ size: Math.max(16, selected.size - 2) })} />
              <ToolButton label="A+" onPress={() => updateLayer({ size: Math.min(64, selected.size + 2) })} />
            </View>
            <View style={styles.row}>
              {COLORS.map((color) => (
                <Pressable
                  key={color}
                  style={[styles.swatch, { backgroundColor: color }, selected.color === color && styles.swatchOn]}
                  onPress={() => updateLayer({ color })}
                />
              ))}
            </View>
            <View style={styles.row}>
              <Pressable style={styles.secondary} onPress={addLayer}>
                <Text style={styles.secondaryLabel}>Add text</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={removeLayer}>
                <Text style={styles.secondaryLabel}>Remove text</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ToolButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tool} onPress={onPress}>
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 54,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  headerAction: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 64,
  },
  nameInput: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  stage: {
    marginHorizontal: 16,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  layer: {
    position: 'absolute',
    width: 160,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
  },
  hint: {
    color: '#a1a1aa',
    fontSize: 13,
    marginHorizontal: 18,
    marginTop: 10,
  },
  tools: {
    padding: 16,
    gap: 10,
  },
  textInput: {
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tool: {
    minWidth: 46,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  toolLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchOn: {
    borderColor: '#60a5fa',
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});
