import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'

interface CitySticker {
  id: string
  renewal_date: string
  auto_renew_enabled: boolean
  reminder_sent: boolean
  completed: boolean
  created_at: string
  notes?: string
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [cityStickers, setCityStickers] = useState<CitySticker[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/')
        return
      }
      
      setUser(user)
      
      // Fetch city sticker reminders
      const { data: stickers, error } = await supabase
        .from('city_sticker_reminders')
        .select('*')
        .eq('user_id', user.id)
        .order('renewal_date', { ascending: true })

      if (error) {
        console.error('Error fetching city stickers:', error)
      } else {
        setCityStickers(stickers || [])
      }
      
      setLoading(false)
    }

    getUser()
  }, [router])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const toggleAutoRenew = async (stickerId: string, currentValue: boolean) => {
    // @ts-ignore
    const { error } = await supabase
      .from('city_sticker_reminders')
      .update({ auto_renew_enabled: !currentValue })
      .eq('id', stickerId)

    if (error) {
      console.error('Error updating auto-renew:', error)
    } else {
      setCityStickers(prev => 
        prev.map(sticker => 
          sticker.id === stickerId 
            ? { ...sticker, auto_renew_enabled: !currentValue }
            : sticker
        )
      )
    }
  }

  const markCompleted = async (stickerId: string) => {
    const { error } = await supabase
      .from('city_sticker_reminders')
      .update({ completed: true, completed_at: new Date().toISOString() })
      .eq('id', stickerId)

    if (error) {
      console.error('Error marking completed:', error)
    } else {
      setCityStickers(prev => 
        prev.map(sticker => 
          sticker.id === stickerId 
            ? { ...sticker, completed: true }
            : sticker
        )
      )
    }
  }

  const getDaysUntilRenewal = (renewalDate: string) => {
    const today = new Date()
    const renewal = new Date(renewalDate)
    const diffTime = renewal.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Dashboard - TicketLess Chicago</title>
      </Head>

      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">TicketLess Chicago</h1>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/profile')}
                className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm"
              >
                Profile
              </button>
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={signOut}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Your City Sticker Reminders</h2>
          <p className="text-gray-600">We'll remind you before each renewal deadline so you never get a ticket.</p>
        </div>

        {cityStickers.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No reminders set up yet</h3>
            <p className="text-gray-600 mb-4">Go back to the homepage to set up your first city sticker reminder.</p>
            <button
              onClick={() => router.push('/')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
            >
              Set Up Reminder
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {cityStickers.map((sticker) => {
              const daysUntil = getDaysUntilRenewal(sticker.renewal_date)
              const isOverdue = daysUntil < 0
              const isUrgent = daysUntil <= 7 && daysUntil >= 0
              
              return (
                <div
                  key={sticker.id}
                  className={`bg-white rounded-lg shadow-sm p-6 border-l-4 ${ 
                    sticker.completed 
                      ? 'border-green-500' 
                      : isOverdue 
                        ? 'border-red-500' 
                        : isUrgent 
                          ? 'border-yellow-500' 
                          : 'border-blue-500'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">City Sticker Renewal</h3>
                      <p className="text-sm text-gray-600">Due: {formatDate(sticker.renewal_date)}</p>
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                      sticker.completed
                        ? 'bg-green-100 text-green-800'
                        : isOverdue
                          ? 'bg-red-100 text-red-800'
                          : isUrgent
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-blue-100 text-blue-800'
                    }`}>
                      {sticker.completed 
                        ? 'Completed' 
                        : isOverdue 
                          ? `${Math.abs(daysUntil)} days overdue` 
                          : `${daysUntil} days left`
                      }
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Auto-renewal:</span>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={sticker.auto_renew_enabled}
                          onChange={() => toggleAutoRenew(sticker.id, sticker.auto_renew_enabled)}
                          disabled={sticker.completed}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-900">
                          {sticker.auto_renew_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </div>

                    {sticker.auto_renew_enabled && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className="text-xs text-blue-800">
                          🚀 <strong>Auto-renewal is coming soon!</strong> We'll notify you when this feature is available.
                        </p>
                      </div>
                    )}

                    {!sticker.completed && (
                      <button
                        onClick={() => markCompleted(sticker.id)}
                        className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg text-sm font-medium"
                      >
                        Mark as Completed
                      </button>
                    )}

                    {sticker.completed && (
                      <div className="bg-green-50 p-3 rounded-lg">
                        <p className="text-sm text-green-800">
                          ✅ Great job! You've renewed your city sticker on time.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add new reminder button */}
        <div className="mt-8 text-center">
          <button
            onClick={() => router.push('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            Add Another Reminder
          </button>
        </div>
      </main>
    </div>
  )
}