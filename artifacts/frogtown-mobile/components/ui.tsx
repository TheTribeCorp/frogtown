import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewProps } from 'react-native';
import { useColors } from '@/hooks/useColors';
export function Label({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  const c = useColors();
  return <Text style={{ color: muted ? c.mutedForeground : c.foreground, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 }}>{children}</Text>;
}
export function Button({ title, onPress, busy, secondary, disabled }: { title: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => ({
    minHeight: 48, padding: 13, borderRadius: c.radius, backgroundColor: secondary ? c.muted : c.primary,
    alignItems: 'center', justifyContent: 'center', opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1,
  })}>{busy ? <ActivityIndicator color={c.primaryForeground} /> : <Text style={{ color: secondary ? c.foreground : c.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{title}</Text>}</Pressable>;
}
export function Field(props: TextInputProps) {
  const c = useColors();
  return <TextInput autoCapitalize="none" autoCorrect={false} placeholderTextColor={c.mutedForeground} {...props} style={[{
    minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: c.radius,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.card, color: c.foreground, fontFamily: 'Inter_400Regular',
  }, props.style]} />;
}
export function Panel(props: ViewProps) {
  const c = useColors();
  return <View {...props} style={[{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 12 }, props.style]} />;
}
export const ui = StyleSheet.create({
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
