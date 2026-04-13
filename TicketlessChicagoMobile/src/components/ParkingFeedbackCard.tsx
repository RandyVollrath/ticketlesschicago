/**
 * ParkingFeedbackCard — Compact in-app card for collecting parking accuracy feedback.
 *
 * Shows three sequential questions after a parking event:
 *   1. "Did you just park?" → Yes / No (not parked / false positive)
 *   2. "Are you on [Street]?" → Yes / Wrong street
 *   3. "Which side?" → North / South or East / West (based on street orientation)
 *
 * Designed to be minimally intrusive — one tap per question, auto-dismisses.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ParkingFeedbackService, ParkingFeedback } from '../services/ParkingFeedbackService';

interface Props {
  onDismiss: () => void;
}

type Step = 'parking' | 'block' | 'side' | 'done';

export const ParkingFeedbackCard: React.FC<Props> = ({ onDismiss }) => {
  const [feedback, setFeedback] = useState<ParkingFeedback | null>(null);
  const [step, setStep] = useState<Step>('parking');

  useEffect(() => {
    ParkingFeedbackService.getPending().then(f => {
      if (f) setFeedback(f);
      else onDismiss();
    });
  }, []);

  if (!feedback) return null;

  const streetLabel = [feedback.streetDirection, feedback.streetName]
    .filter(Boolean).join(' ');

  // Determine which side options to show based on street orientation
  const isNSStreet = feedback.streetDirection === 'N' || feedback.streetDirection === 'S';
  const sideOptions = isNSStreet
    ? [{ label: 'East side', value: 'E' as const }, { label: 'West side', value: 'W' as const }]
    : [{ label: 'North side', value: 'N' as const }, { label: 'South side', value: 'S' as const }];

  const handleParking = async (confirmed: boolean) => {
    await ParkingFeedbackService.answerParking(confirmed);
    if (confirmed) {
      setStep('block');
    } else {
      setStep('done');
      setTimeout(onDismiss, 500);
    }
  };

  const handleBlock = async (correct: boolean) => {
    await ParkingFeedbackService.answerBlock(correct);
    if (correct) {
      setStep('side');
    } else {
      // Wrong street — still ask for side so we learn
      setStep('side');
    }
  };

  const handleSide = async (side: 'N' | 'S' | 'E' | 'W') => {
    await ParkingFeedbackService.answerSide(side);
    setStep('done');
    setTimeout(onDismiss, 500);
  };

  const handleSkip = async () => {
    await ParkingFeedbackService.skip();
    onDismiss();
  };

  if (step === 'done') {
    return (
      <View style={styles.card}>
        <Text style={styles.thanks}>Thanks! This helps improve accuracy.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Quick check</Text>
        <TouchableOpacity onPress={handleSkip} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      {step === 'parking' && (
        <View>
          <Text style={styles.question}>Did you just park?</Text>
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.btnYes} onPress={() => handleParking(true)}>
              <Text style={styles.btnText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnNo} onPress={() => handleParking(false)}>
              <Text style={styles.btnText}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'block' && (
        <View>
          <Text style={styles.question}>Are you on {streetLabel}?</Text>
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.btnYes} onPress={() => handleBlock(true)}>
              <Text style={styles.btnText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnNo} onPress={() => handleBlock(false)}>
              <Text style={styles.btnText}>Wrong street</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'side' && (
        <View>
          <Text style={styles.question}>Which side of the street?</Text>
          <View style={styles.buttons}>
            {sideOptions.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.btnSide,
                  opt.value === feedback.resolvedSide && styles.btnSideHighlight,
                ]}
                onPress={() => handleSide(opt.value)}
              >
                <Text style={styles.btnText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#8888aa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  skip: {
    color: '#666',
    fontSize: 12,
  },
  question: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 12,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  btnYes: {
    flex: 1,
    backgroundColor: '#2d5a3d',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnNo: {
    flex: 1,
    backgroundColor: '#5a2d2d',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSide: {
    flex: 1,
    backgroundColor: '#2a2a4a',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSideHighlight: {
    borderColor: '#4a7aff',
    borderWidth: 1,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  thanks: {
    color: '#88aa88',
    fontSize: 14,
    textAlign: 'center',
  },
});
